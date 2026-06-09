import type { FastifyReply } from 'fastify';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const sendError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
  }
  const message = error instanceof Error ? error.message : 'Unexpected error';
  return reply.status(500).send({ error: { code: 'internal_error', message } });
};
