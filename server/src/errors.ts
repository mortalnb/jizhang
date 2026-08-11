import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const sendError = (reply: FastifyReply, error: unknown, requestId: string) => {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId } });
  }
  if (error instanceof ZodError) {
    return reply.status(400).send({ error: { code: 'invalid_request', message: 'Request validation failed', requestId } });
  }
  if (
    (typeof error === 'object' && error && 'statusCode' in error && (error as { statusCode?: unknown }).statusCode === 401) ||
    (typeof error === 'object' && error && 'code' in error && String((error as { code?: unknown }).code).startsWith('FST_JWT_'))
  ) {
    return reply.status(401).send({ error: { code: 'invalid_session', message: 'Session is invalid or expired', requestId } });
  }
  if (typeof error === 'object' && error && 'statusCode' in error) {
    const statusCode = Number((error as { statusCode?: unknown }).statusCode);
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500) {
      const code = statusCode === 413 ? 'payload_too_large' : statusCode === 429 ? 'rate_limited' : 'invalid_request';
      const message = statusCode === 413 ? 'Request payload is too large' : statusCode === 429 ? 'Too many requests' : 'Request is invalid';
      return reply.status(statusCode).send({ error: { code, message, requestId } });
    }
  }
  return reply.status(500).send({ error: { code: 'internal_error', message: 'Unexpected server error', requestId } });
};
