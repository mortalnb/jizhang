import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { config } from './config.js';
import { registerAuthRoutes } from './auth.js';
import { sendError } from './errors.js';
import { registerModelRoutes } from './modelRoutes.js';
import { registerLedgerRoutes } from './ledgerRoutes.js';
import { prisma } from './db.js';

const app = Fastify({ logger: { redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body', 'res.headers.set-cookie', 'err'] }, bodyLimit: 14_000_000 });

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || config.corsOrigin.includes(origin)) return callback(null, true);
    callback(new Error('Origin not allowed'), false);
  },
});
await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '15m' } });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

app.setErrorHandler((error, request, reply) => sendError(reply, error, request.id));

app.get('/health', async () => ({ ok: true }));
app.get('/api/version', async () => ({
  name: 'jizhang-server',
  version: process.env.APP_VERSION || '0.2.0-rc.2',
  gitSha: process.env.GIT_SHA || 'development',
  capabilities: ['batch-parse', 'bill-grouping', 'mimo-v2.5-asr', 'ledger-sync', 'ledger-analysis'],
}));

registerAuthRoutes(app);
registerModelRoutes(app);
registerLedgerRoutes(app);

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
};

process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

await app.listen({ host: config.host, port: config.port });
