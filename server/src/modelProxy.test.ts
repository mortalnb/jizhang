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
  vi.restoreAllMocks();
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

  it('returns an undated Hema checkout as a warned editable draft to the old APK', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: 'mimo-v2.6-flash', choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify({ source: 'hema', amount: 48, transactions: [{
          amount: 48, category: '其他', description: '盒马采购', date: '',
          splitItems: [
            { amount: 9.59, category: '其他', description: '米布', quantity: '1组' },
            { amount: 17.51, category: '饮料', description: '果汁', quantity: '1瓶' },
            { amount: 19.9, category: '饮料', description: '牛奶', quantity: '1组' },
          ],
        }] }),
      } }],
    })));
    vi.stubGlobal('fetch', fetchMock);
    const timerSpy = vi.spyOn(globalThis, 'setTimeout');
    const response = await app.inject({ method: 'POST', url: '/api/model/recognize-bill-image', payload: {
      model: 'mimo-v2.5', categories: input.categories, imageDataUrl: 'data:image/jpeg;base64,' + 'x'.repeat(100),
    } });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.transactions).toHaveLength(1);
    expect(response.json().result.transactions[0]).toMatchObject({ amount: 48, grouping: 'folded' });
    expect(response.json().result.transactions[0].splitItems).toHaveLength(3);
    expect(response.json().result.transactions[0]).not.toHaveProperty('date');
    expect(response.json().result.warnings[0]).toContain('日期待确认');
    expect(assertModelAccess).toHaveBeenCalledWith('test-user', 'mimo-v2.5', 'recognize-bill-image');
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ success: true, endpoint: 'recognize-bill-image', model: 'mimo-v2.5' }));
    expect(timerSpy.mock.calls.some(([, deadline]) => deadline === 180_000)).toBe(true);
    timerSpy.mockRestore();
  });
});
