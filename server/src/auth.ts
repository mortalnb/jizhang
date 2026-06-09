import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from './db.js';
import { AppError } from './errors.js';
import { addDays } from './time.js';
import { hashToken, randomToken, verifyPassword } from './security.js';
import type { AuthenticatedRequest, JwtPayload } from './types.js';

const loginSchema = z.object({
  deviceId: z.string().min(8).max(128),
  deviceLabel: z.string().max(120).optional(),
  password: z.string().min(1).max(200),
  username: z.string().min(1).max(80),
});

export const requireAuth = async (request: FastifyRequest) => {
  const payload = await request.jwtVerify<JwtPayload>();
  const session = await prisma.authSession.findUnique({ where: { id: payload.sessionId } });
  if (!session || session.userId !== payload.userId || session.deviceId !== payload.deviceId || session.expiresAt <= new Date()) {
    throw new AppError(401, 'invalid_session', 'Session is invalid or expired');
  }
  (request as AuthenticatedRequest).auth = payload;
};

export const registerAuthRoutes = (app: FastifyInstance) => {
  app.post('/api/auth/login', async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { username: input.username },
      include: { deviceBinding: true, entitlement: true },
    });
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new AppError(401, 'invalid_credentials', 'Invalid username or password');
    }
    if (!user.isEnabled) throw new AppError(403, 'user_disabled', 'User is disabled');

    if (user.deviceBinding && user.deviceBinding.deviceId !== input.deviceId) {
      throw new AppError(409, 'device_already_bound', 'This account is already bound to another device');
    }

    await prisma.deviceBinding.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        deviceId: input.deviceId,
        deviceLabel: input.deviceLabel,
      },
      update: {
        deviceLabel: input.deviceLabel,
        lastSeenAt: new Date(),
      },
    });

    await prisma.authSession.deleteMany({ where: { userId: user.id, deviceId: input.deviceId } });
    const refreshToken = randomToken();
    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        deviceId: input.deviceId,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: addDays(30),
      },
    });

    const accessToken = await reply.jwtSign({
      deviceId: input.deviceId,
      sessionId: session.id,
      userId: user.id,
      username: user.username,
    });

    return {
      accessToken,
      refreshToken,
      user: serializeUser(user),
      entitlement: serializeEntitlement(user.entitlement),
    };
  });

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (request, reply: FastifyReply) => {
    const auth = (request as AuthenticatedRequest).auth;
    await prisma.authSession.deleteMany({ where: { id: auth.sessionId, userId: auth.userId } });
    return reply.send({ ok: true });
  });

  app.get('/api/me', { preHandler: requireAuth }, async request => {
    const auth = (request as AuthenticatedRequest).auth;
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      include: { deviceBinding: true, entitlement: true },
    });
    if (!user || !user.isEnabled) throw new AppError(403, 'user_disabled', 'User is disabled');
    await prisma.deviceBinding.updateMany({
      where: { userId: user.id, deviceId: auth.deviceId },
      data: { lastSeenAt: new Date() },
    });
    return {
      user: serializeUser(user),
      device: user.deviceBinding,
      entitlement: serializeEntitlement(user.entitlement),
    };
  });
};

const serializeUser = (user: { displayName: string | null; id: string; isEnabled: boolean; username: string }) => ({
  displayName: user.displayName,
  id: user.id,
  isEnabled: user.isEnabled,
  username: user.username,
});

const serializeEntitlement = (
  entitlement: { allowedModels: string[]; canUseModelProxy: boolean; dailyLimit: number; expiresAt: Date | null; monthlyLimit: number } | null,
) =>
  entitlement
    ? {
        allowedModels: entitlement.allowedModels,
        canUseModelProxy: entitlement.canUseModelProxy,
        dailyLimit: entitlement.dailyLimit,
        expiresAt: entitlement.expiresAt?.toISOString() ?? null,
        monthlyLimit: entitlement.monthlyLimit,
      }
    : null;
