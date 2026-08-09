import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { requireAuth } from './auth.js';
import { prisma } from './db.js';
import { AppError } from './errors.js';
import { checksumLedgerPayload, ledgerUpdateSchema } from './ledgerContracts.js';
import type { AuthenticatedRequest } from './types.js';

const serializeSnapshot = (snapshot: { checksum: string; payload: Prisma.JsonValue; revision: number; updatedAt: Date }) => ({
  checksum: snapshot.checksum,
  payload: snapshot.payload,
  revision: snapshot.revision,
  updatedAt: snapshot.updatedAt.toISOString(),
});

export const registerLedgerRoutes = (app: FastifyInstance) => {
  app.get('/api/ledger-snapshot', { preHandler: requireAuth }, async request => {
    const auth = (request as AuthenticatedRequest).auth;
    const snapshot = await prisma.ledgerSnapshot.findUnique({ where: { userId: auth.userId } });
    return { snapshot: snapshot ? serializeSnapshot(snapshot) : null };
  });

  app.put('/api/ledger-snapshot', { preHandler: requireAuth }, async request => {
    const auth = (request as AuthenticatedRequest).auth;
    const input = ledgerUpdateSchema.parse(request.body);
    if (checksumLedgerPayload(input.payload) !== input.checksum) {
      throw new AppError(400, 'ledger_checksum_mismatch', 'Ledger checksum does not match the submitted payload');
    }

    const snapshot = await prisma.$transaction(async tx => {
      const current = await tx.ledgerSnapshot.findUnique({ where: { userId: auth.userId } });
      if (!current) {
        if (input.expectedRevision !== 0) throw new AppError(409, 'ledger_revision_conflict', 'Cloud ledger revision changed');
        try {
          return await tx.ledgerSnapshot.create({
            data: {
              userId: auth.userId,
              revision: 1,
              checksum: input.checksum,
              schemaVersion: input.payload.schemaVersion,
              payload: input.payload,
              deviceId: auth.deviceId,
            },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new AppError(409, 'ledger_revision_conflict', 'Cloud ledger revision changed');
          }
          throw error;
        }
      }
      if (current.revision !== input.expectedRevision) throw new AppError(409, 'ledger_revision_conflict', 'Cloud ledger revision changed');
      const updated = await tx.ledgerSnapshot.updateMany({
        where: { userId: auth.userId, revision: input.expectedRevision },
        data: {
          revision: { increment: 1 },
          checksum: input.checksum,
          schemaVersion: input.payload.schemaVersion,
          payload: input.payload,
          deviceId: auth.deviceId,
        },
      });
      if (updated.count !== 1) throw new AppError(409, 'ledger_revision_conflict', 'Cloud ledger revision changed');
      return tx.ledgerSnapshot.findUniqueOrThrow({ where: { userId: auth.userId } });
    });
    return { snapshot: serializeSnapshot(snapshot) };
  });
};

