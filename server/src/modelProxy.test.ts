import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from './types.js';

vi.mock('./auth.js', () => ({
  requireAuth: async (request: AuthenticatedRequest) => {
    request.auth = { userId: 'test-user', deviceId: 'test-device', sessionId: 'test-session', username: 'test-user' };
  },
}));
vi.mock('./quota.js', () => ({ assertModelAccess: vi.fn(), recordUsage: vi.fn().mockResolvedValue({}) }));

import { AppError, sendError } from './errors.js';
import { registerModelRoutes } from './modelRoutes.js';
import { assertModelAccess, recordUsage } from './quota.js';

let app: FastifyInstance;
beforeEach(() => {
  vi.mocked(assertModelAccess).mockReset();
  vi.mocked(recordUsage).mockClear();
  app = Fastify();
  app.setErrorHandler((error, request, reply) => sendError(reply, error, request.id));
  registerModelRoutes(app);
});
afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

const input = { model: 'mimo-v2.5', categories: ['饮料', '其他'], text: '咖啡十八元' };

describe('old APK proxy authorization and response contract', () => {
  it('authorizes and accounts for the requested name while sending Flash and returning the existing result shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: 'mimo-v2.6-flash', choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify({ transactions: [{ amount: 18, category: '饮料', description: '咖啡', date: '2026-10-09' }] }),
      } }],
    })));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'POST', url: '/api/model/parse-transaction', payload: input });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.transactions[0]).toMatchObject({ amount: 18, category: '饮料', description: '咖啡' });
    expect(assertModelAccess).toHaveBeenCalledWith('test-user', 'mimo-v2.5', 'parse-transaction');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('mimo-v2.6-flash');
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ model: 'mimo-v2.5', success: true }));
  });

  it.each(['mimo-v2.5', 'mimo-v2.6-flash'])('does not bypass authorization for %s', async model => {
    vi.mocked(assertModelAccess).mockRejectedValue(new AppError(403, 'model_not_allowed', 'This model is not allowed for this account'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'POST', url: '/api/model/parse-transaction', payload: { ...input, model } });
    expect(response.statusCode).toBe(403);
    expect(assertModelAccess).toHaveBeenCalledWith('test-user', model, 'parse-transaction');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('keeps invalid structured output as a recorded failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: 'mimo-v2.6-flash', choices: [{ finish_reason: 'length', message: { content: '{"transactions":[' } }],
    }))));
    const response = await app.inject({ method: 'POST', url: '/api/model/parse-transaction', payload: input });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('mimo_invalid_result');
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ model: 'mimo-v2.5', success: false, errorCode: 'mimo_invalid_result' }));
  });
});
