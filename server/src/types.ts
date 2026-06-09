import type { FastifyRequest } from 'fastify';

export interface JwtPayload {
  deviceId: string;
  sessionId: string;
  userId: string;
  username: string;
}

export type AuthenticatedRequest = FastifyRequest & {
  auth: JwtPayload;
};

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}
