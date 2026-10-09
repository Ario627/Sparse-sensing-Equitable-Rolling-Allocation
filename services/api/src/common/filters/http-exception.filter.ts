import type { Request, Response } from 'express';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

interface HttpErrorPayload {
  readonly message: string;
  readonly details?: unknown;
}

const STANDARD_PAYLOAD_KEYS = new Set(['statusCode', 'error', 'message']);
const VALIDATION_MESSAGE = 'Validation failed';
const INTERNAL_MESSAGE = 'Internal server error';
const FALLBACK_CODE = 'HTTP_ERROR';

function codeForStatus(status: number): string {
  const name: string | undefined = HttpStatus[status];
  return name ?? FALLBACK_CODE;
}

function extractDetails(
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const entries = Object.entries(payload).filter(
    ([key]) => !STANDARD_PAYLOAD_KEYS.has(key),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function extractHttpErrorPayload(exception: HttpException): HttpErrorPayload {
  const payload = exception.getResponse();
  if (typeof payload === 'string') {
    return { message: payload };
  }
  if (typeof payload !== 'object' || payload === null) {
    return { message: exception.message };
  }
  const record = payload as Record<string, unknown>;
  const details = extractDetails(record);
  if (Array.isArray(record.message)) {
    return { message: VALIDATION_MESSAGE, details: record.message };
  }
  if (typeof record.message === 'string' && record.message.length > 0) {
    return { message: record.message, details };
  }
  return { message: exception.message, details };
}

function resolveErrorPayload(exception: unknown): HttpErrorPayload {
  return exception instanceof HttpException
    ? extractHttpErrorPayload(exception)
    : { message: INTERNAL_MESSAGE };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      return;
    }

    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = resolveErrorPayload(exception);
    const code = codeForStatus(status);

    this.report(exception, request, status, code);

    const envelope: ErrorEnvelope = {
      error: {
        code,
        message: payload.message,
        ...(payload.details === undefined ? {} : { details: payload.details }),
      },
    };
    response.status(status).json(envelope);
  }

  private report(
    exception: unknown,
    request: Request,
    status: number,
    code: string,
  ): void {
    const target = `${request.method} ${request.originalUrl} -> ${status} ${code}`;
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        target,
        exception instanceof Error ? exception.stack : undefined,
      );
      return;
    }
    this.logger.debug(target);
  }
}