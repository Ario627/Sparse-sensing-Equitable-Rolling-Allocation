import type { NextFunction, Request, Response } from 'express';

const HSTS_MAX_AGE_SECONDS = 31_536_000;
const HSTS_HEADER = `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`;

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export interface SecurityHeadersOptions {
  readonly hsts: boolean;
}

function resolveHeaders(options: SecurityHeadersOptions): Record<string, string> {
    return options.hsts
        ? {...SECURITY_HEADERS, 'Strict-Transport-Security': HSTS_HEADER }
        : {...SECURITY_HEADERS};
}

export function createSecurityHeadersMiddleware(options: SecurityHeadersOptions): (request: Request, response: Response, next: NextFunction) => void {
    const headers = resolveHeaders(options);
    return (_request, response, next) => {
        response.set(headers);
        next();
    }
}