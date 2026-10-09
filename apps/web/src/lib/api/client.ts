import { authSessionResponseSchema } from "@sera/contracts";
import z from "zod";
import {
  clearSession,
  readAccessToken,
  readExpiresAt,
  setSession,
} from "../auth/session-store";

const DEFAULT_BASE_URL = "/v1";
const DEFAULT_TIMEOUT_MS = 15_000;
const REFRESH_MARGIN_MS = 30_000;
const REFRESH_BACKOFF_MS = 3_000;
const REFRESH_PATH = "/auth/refresh";
const TOKENLESS_PATHS = new Set(["/auth/login", REFRESH_PATH, "/auth/logout"]);

const baseUrl: string = import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BASE_URL;

let refreshInFlight: Promise<string | null> | null = null;
let refreshBlockedUntil = 0;

export type ApiErrorKind =
  | "http"
  | "network"
  | "timeout"
  | "aborted"
  | "invalid_response";

export interface ApiErrorInit {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
}

export interface ApiRequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly cache?: RequestCache;
}

interface AttemptConfig {
  readonly path: string;
  readonly method: string;
  readonly body: unknown;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
  readonly cache: RequestCache;
}

interface Attempt {
  readonly response: Response;
  readonly requestId: string;
}

interface ErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly details: unknown;
}

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? null;
    this.requestId = init.requestId;
    this.method = init.method;
    this.path = init.path;
  }
}

const refreshConfig: AttemptConfig = {
  path: REFRESH_PATH,
  method: "POST",
  body: undefined,
  signal: undefined,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  cache: "no-store",
};

function newRequestId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requestUrl(path: string): string {
  return `${baseUrl}${path}`;
}

function isTokenlessPath(path: string): boolean {
  return TOKENLESS_PATHS.has(path);
}

function withinRefreshBackoff(now: number): boolean {
  return now < refreshBlockedUntil;
}

function blockRefresh(): void {
  refreshBlockedUntil = Date.now() + REFRESH_BACKOFF_MS;
}

function composeSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

function toAttemptConfig(path: string, options: ApiRequestOptions): AttemptConfig {
  return {
    path,
    method: options.method ?? "GET",
    body: options.body,
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    cache: options.cache ?? "no-store",
  };
}

function isExpiringSoon(now: number): boolean {
  const expiresAt = readExpiresAt();
  return expiresAt !== null && now >= expiresAt - REFRESH_MARGIN_MS;
}

function fallbackErrorEnvelope(status: number): ErrorEnvelope {
  return {
    code: `HTTP_${status}`,
    message: `Permintaan gagal dengan status ${status}`,
    details: null,
  };
}

async function readErrorEnvelope(response: Response): Promise<ErrorEnvelope> {
  const parsed = errorEnvelopeSchema.safeParse(
    await response.json().catch(() => undefined),
  );
  return parsed.success
    ? {
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        details: parsed.data.error.details ?? null,
      }
    : fallbackErrorEnvelope(response.status);
}

function toTransportError(
  error: unknown,
  requestId: string,
  config: AttemptConfig,
): ApiError {
  const isDomException = error instanceof DOMException;
  if (isDomException && error.name === "TimeoutError") {
    return new ApiError({
      kind: "timeout",
      status: null,
      code: "TIMEOUT",
      message: "Permintaan melebihi batas waktu",
      requestId,
      method: config.method,
      path: config.path,
    });
  }
  if (isDomException && error.name === "AbortError") {
    return new ApiError({
      kind: "aborted",
      status: null,
      code: "ABORTED",
      message: "Permintaan dibatalkan",
      requestId,
      method: config.method,
      path: config.path,
    });
  }
  return new ApiError({
    kind: "network",
    status: null,
    code: "NETWORK_ERROR",
    message: "Tidak dapat menghubungi server SERA",
    details: error instanceof Error ? error.message : null,
    requestId,
    method: config.method,
    path: config.path,
  });
}

async function toResponseError(
  attempt: Attempt,
  config: AttemptConfig,
): Promise<ApiError> {
  const envelope = await readErrorEnvelope(attempt.response);
  return new ApiError({
    kind: "http",
    status: attempt.response.status,
    code: envelope.code,
    message: envelope.message,
    details: envelope.details,
    requestId: attempt.requestId,
    method: config.method,
    path: config.path,
  });
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => undefined);
}

async function attemptRequest(
  config: AttemptConfig,
  token: string | null,
): Promise<Attempt> {
  const requestId = newRequestId();
  const headers = new Headers({ Accept: "application/json" });
  if (token !== null) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  let body: string | undefined;
  if (config.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(config.body);
  }
  try {
    const response = await fetch(requestUrl(config.path), {
      method: config.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      cache: config.cache,
      credentials: "include",
      signal: composeSignal(config.signal, config.timeoutMs),
    });
    return { response, requestId };
  } catch (error) {
    throw toTransportError(error, requestId, config);
  }
}

async function executeRefresh(): Promise<string | null> {
  try {
    const attempt = await attemptRequest(refreshConfig, null);
    if (!attempt.response.ok) {
      blockRefresh();
      clearSession();
      return null;
    }
    const session = authSessionResponseSchema.parse(await readJson(attempt.response));
    setSession(session);
    return session.access_token;
  } catch {
    blockRefresh();
    clearSession();
    return null;
  }
}

function refreshSession(): Promise<string | null> {
  if (refreshInFlight !== null) {
    return refreshInFlight;
  }
  if (withinRefreshBackoff(Date.now())) {
    return Promise.resolve(null);
  }
  const pending = executeRefresh().finally(() => {
    refreshInFlight = null;
  });
  refreshInFlight = pending;
  return pending;
}

async function ensureSessionToken(path: string): Promise<void> {
  if (isTokenlessPath(path)) {
    return;
  }
  const now = Date.now();
  if (readAccessToken() === null || isExpiringSoon(now)) {
    await refreshSession();
  }
}

async function sendWithAuth(config: AttemptConfig): Promise<Attempt> {
  await ensureSessionToken(config.path);
  const first = await attemptRequest(config, readAccessToken());
  if (first.response.status !== 401 || isTokenlessPath(config.path)) {
    return first;
  }
  const token = await refreshSession();
  return token === null ? first : attemptRequest(config, token);
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export async function apiFetch<T>(
  schema: z.ZodType<T>,
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const config = toAttemptConfig(path, options);
  const attempt = await sendWithAuth(config);
  if (!attempt.response.ok) {
    throw await toResponseError(attempt, config);
  }
  const parsed = schema.safeParse(await readJson(attempt.response));
  if (!parsed.success) {
    throw new ApiError({
      kind: "invalid_response",
      status: attempt.response.status,
      code: "INVALID_RESPONSE",
      message: "Respons server tidak sesuai kontrak",
      details: parsed.error.issues,
      requestId: attempt.requestId,
      method: config.method,
      path: config.path,
    });
  }
  return parsed.data;
}

export async function apiVoid(
  path: string,
  options: ApiRequestOptions = {},
): Promise<void> {
  const config = toAttemptConfig(path, options);
  const attempt = await sendWithAuth(config);
  if (!attempt.response.ok) {
    throw await toResponseError(attempt, config);
  }
}

export async function restoreSession(): Promise<boolean> {
  const token = await refreshSession();
  return token !== null;
}
async function readTextBody(response: Response): Promise<string> {
  return response.text().catch(() => "");
}

export async function apiText(
  path: string,
  options: ApiRequestOptions = {},
): Promise<string> {
  const config = toAttemptConfig(path, options);
  const attempt = await sendWithAuth(config);
  if (!attempt.response.ok) {
    throw await toResponseError(attempt, config);
  }
  return readTextBody(attempt.response);
}
