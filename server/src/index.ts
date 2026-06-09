import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { config } from './config.js';
import { registerAuthRoutes } from './auth.js';
import { sendError } from './errors.js';
import { registerModelRoutes } from './modelRoutes.js';
import { prisma } from './db.js';

const app = Fastify({ logger: true, bodyLimit: 7_500_000 });

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || config.corsOrigin.includes(origin)) return callback(null, true);
    callback(new Error('Origin not allowed'), false);
  },
});
await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '15m' } });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

app.setErrorHandler((error, _request, reply) => sendError(reply, error));

app.get('/health', async () => ({ ok: true }));
app.get('/api/version', async () => ({ name: 'jizhang-server', version: '0.1.0' }));

registerAuthRoutes(app);
registerModelRoutes(app);

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
};

process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

await app.listen({ host: config.host, port: config.port });
