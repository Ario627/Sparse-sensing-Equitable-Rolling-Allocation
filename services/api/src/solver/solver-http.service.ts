import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../common/config/env.ts';

export class SolverUnavailableError extends Error {}

export class SolverRejectedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class SolverContractError extends Error {}

function extractRejectionDetail(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const detail = (body as Record<string, unknown>).detail;
  return typeof detail === 'string' && detail.length > 0 ? detail : null;
}

@Injectable()
export class SolverHttpService {
  private readonly logger = new Logger(SolverHttpService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config
      .get('SOLVER_URL', { infer: true })
      .replace(/\/+$/, '');
    this.timeoutMs = config.get('SOLVER_TIMEOUT_MS', { infer: true });
  }

  postJson(path: string, body: unknown): Promise<unknown> {
    return this.send('POST', path, JSON.stringify(body));
  }

  getJson(path: string): Promise<unknown> {
    return this.send('GET', path, undefined);
  }

  private async send(
    method: 'GET' | 'POST',
    path: string,
    body: string | undefined,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new SolverUnavailableError(
        `solver request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (response.status >= 500) {
      throw new SolverUnavailableError(`solver responded ${response.status}`);
    }
    if (!response.ok) {
      const detail = await this.readJsonSafely(response);
      const message =
        extractRejectionDetail(detail) ?? `solver responded ${response.status}`;
      this.logger.warn(`solver rejected ${method} ${path}: ${message}`);
      throw new SolverRejectedError(message, response.status);
    }
    const payload = await this.readJsonSafely(response);
    if (payload === null) {
      throw new SolverContractError('solver returned an empty or invalid body');
    }
    return payload;
  }

  private async readJsonSafely(response: Response): Promise<unknown | null> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
}
