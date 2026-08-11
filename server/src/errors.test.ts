import type { FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { sendError } from './errors.js';

const replyDouble = () => {
  const reply = {
    send: vi.fn((payload: unknown) => payload),
    status: vi.fn(),
  };
  reply.status.mockReturnValue(reply);
  return reply;
};

describe('sendError', () => {
  it('maps Zod validation failures to a safe 400 response', () => {
    let validationError: unknown;
    try {
      z.object({ username: z.string().min(1) }).parse({});
    } catch (error) {
      validationError = error;
    }
    const reply = replyDouble();
    sendError(reply as unknown as FastifyReply, validationError, 'req-test');
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(reply.send).toHaveBeenCalledWith({ error: { code: 'invalid_request', message: 'Request validation failed', requestId: 'req-test' } });
  });

  it.each([
    [413, 'payload_too_large', 'Request payload is too large'],
    [429, 'rate_limited', 'Too many requests'],
  ])('preserves safe Fastify HTTP status %i', (statusCode, code, message) => {
    const reply = replyDouble();
    sendError(reply as unknown as FastifyReply, { statusCode }, 'req-test');
    expect(reply.status).toHaveBeenCalledWith(statusCode);
    expect(reply.send).toHaveBeenCalledWith({ error: { code, message, requestId: 'req-test' } });
  });
});
