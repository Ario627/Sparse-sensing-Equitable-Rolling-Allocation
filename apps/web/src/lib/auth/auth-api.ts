import {
  type AuthSessionResponse,
  authSessionResponseSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type MeResponse,
  meResponseSchema,
} from "@sera/contracts";
import { apiFetch, apiVoid } from "@/lib/api/client.ts";
import { clearSession, setSession } from "./session-store.ts";

export async function login(request: LoginRequest): Promise<AuthSessionResponse> {
  const session = await apiFetch(authSessionResponseSchema, "/auth/login", {
    method: "POST",
    body: request,
  });
  setSession(session);
  return session;
}

export async function fetchSession(): Promise<MeResponse> {
  return apiFetch(meResponseSchema, "/auth/me");
}

export async function logout(): Promise<void> {
  try {
    await apiVoid("/auth/logout", { method: "POST" });
  } finally {
    clearSession();
  }
}

export async function changePassword(request: ChangePasswordRequest): Promise<void> {
  await apiVoid("/auth/password", {
    method: "PUT",
    body: request,
  });
  clearSession();
}
