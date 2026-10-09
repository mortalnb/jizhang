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
import { config } from './config.js';
import { registerModelRoutes } from './modelRoutes.js';
import { assertModelAccess, recordUsage } from './quota.js';

let app: FastifyInstance;
beforeEach(() => {
  config.billImageProvider = 'mimo';
  config.textModelProvider = 'mimo';
  config.deepseekApiKey = undefined;
  vi.mocked(assertModelAccess).mockReset();
  vi.mocked(recordUsage).mockClear();
  app = Fastify();
  app.setErrorHandler((error, request, reply) => sendError(reply, error, request.id));
  registerModelRoutes(app);
});
afterEach(async () => {
  config.billImageProvider = 'mimo';
  config.textModelProvider = 'mimo';
  config.deepseekApiKey = undefined;
  await app.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const imageInput = { model: 'mimo-v2.5', categories: ['饮料', '其他'], imageDataUrl: 'data:image/jpeg;base64,' + 'x'.repeat(100) };
const visionResponse = () => new Response(JSON.stringify({
  model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: {
    content: JSON.stringify({ source: 'hema', transactions: [{
      amount: 48, category: '其他', description: '盒马采购',
      splitItems: [
        { amount: 9.59, category: '其他', description: '米布', quantity: '1组' },
        { amount: 17.51, category: '饮料', description: '果汁', quantity: '1瓶' },
        { amount: 19.9, category: '饮料', description: '牛奶', quantity: '1组' },
      ],
    }] }),
  } }],
}));

describe('server-selected image provider', () => {
  beforeEach(() => {
    config.billImageProvider = 'deepseek';
    config.deepseekApiKey = 'vitest-only-deepseek-key';
  });

  it('sends the original screenshot to DeepSeek and keeps the old APK draft and accounting contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(visionResponse());
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'POST', url: '/api/model/recognize-bill-image', payload: imageInput });
    expect(response.statusCode).toBe(200);
    expect(response.json().result.transactions[0]).toMatchObject({ amount: 48, grouping: 'folded' });
    expect(response.json().result.transactions[0].splitItems).toHaveLength(3);
    expect(response.json().result.transactions[0]).not.toHaveProperty('date');
    expect(response.json().result.warnings[0]).toContain('日期待确认');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('deepseek-flash');
    expect(body.messages[1].content[1].image_url).toEqual({ url: imageInput.imageDataUrl, detail: 'original' });
    expect(assertModelAccess).toHaveBeenCalledWith('test-user', 'mimo-v2.5', 'recognize-bill-image');
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ success: true, endpoint: 'recognize-bill-image', model: 'mimo-v2.5' }));
  });

  it('continues routing text and audio to MiMo when only images use DeepSeek', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ transactions: [{ amount: 18, category: '饮料', description: '咖啡', date: '2026-10-09' }] }) } }],
    }))).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { audio: { transcript: '今天买咖啡十八元' } } }] })));
    vi.stubGlobal('fetch', fetchMock);
    const text = await app.inject({ method: 'POST', url: '/api/model/parse-transaction', payload: input });
    const audio = await app.inject({ method: 'POST', url: '/api/model/transcribe-audio', payload: {
      model: 'mimo-v2.5-asr', durationSeconds: 1, audioDataUrl: 'data:audio/wav;base64,' + 'x'.repeat(100),
    } });
    expect(text.statusCode).toBe(200);
    expect(audio.statusCode).toBe(200);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'https://api.xiaomimimo.com/v1/chat/completions', 'https://api.xiaomimimo.com/v1/chat/completions',
    ]);
    expect(fetchMock.mock.calls.map(call => JSON.parse(call[1].body).model)).toEqual(['mimo-v2.6-flash', 'mimo-v2.5-asr']);
  });

  it.each(['mimo', 'deepseek'] as const)('checks original image authorization before calling %s', async provider => {
    config.billImageProvider = provider;
    vi.mocked(assertModelAccess).mockRejectedValue(new AppError(403, 'model_not_allowed', 'This model is not allowed for this account'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'POST', url: '/api/model/recognize-bill-image', payload: imageInput });
    expect(response.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('records one static provider failure when DeepSeek rejects the call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private-upstream-body', { status: 429 })));
    const response = await app.inject({ method: 'POST', url: '/api/model/recognize-bill-image', payload: imageInput });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('deepseek_http_error');
    expect(response.body).not.toContain('private-upstream-body');
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ success: false, model: 'mimo-v2.5', errorCode: 'deepseek_http_error' }));
  });

  it('rejects incomplete model content and records one contract failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ finish_reason: 'length', message: { content: '{"transactions":[' } }],
    }))));
    const response = await app.inject({ method: 'POST', url: '/api/model/recognize-bill-image', payload: imageInput });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('deepseek_invalid_result');
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ success: false, errorCode: 'deepseek_invalid_result' }));
  });
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

const textRouteCases = [
  {
    endpoint: 'parse-transaction',
    payload: input,
    content: { transactions: [{ amount: 18, category: '饮料', description: '咖啡', date: '2026-10-09' }] },
    expected: { transactions: [{ amount: 18, category: '饮料', description: '咖啡', date: '2026-10-09' }] },
    maxTokens: 4096,
    temperature: 0.1,
  },
  {
    endpoint: 'analyze-ledger',
    payload: {
      model: 'mimo-v2.5', financialFacts: { budget: 3000, totalSpent: 18 }, monthSummaries: [],
      recentTransactions: [{ amount: 18, category: '饮料', description: '咖啡', date: '2026-10-09' }],
      requirements: ['只使用已提供的数据。'],
    },
    content: { insights: [{ title: '已记录支出', body: '已记录18元支出。', tone: 'info' }] },
    expected: { insights: [{ title: '已记录支出', body: '已记录18元支出。', tone: 'info' }] },
    maxTokens: 2048,
    temperature: 0.2,
  },
  {
    endpoint: 'test-capability',
    payload: { model: 'mimo-v2.5' },
    content: { text: true, json: true, vision: true },
    expected: { text: true, json: true, vision: true, audio: true },
    maxTokens: 1024,
    temperature: 0.1,
  },
];

describe('server-selected text provider', () => {
  beforeEach(() => {
    config.textModelProvider = 'deepseek';
    config.billImageProvider = 'deepseek';
    config.deepseekApiKey = 'vitest-only-deepseek-key';
  });

  it.each(textRouteCases)('routes $endpoint to DeepSeek with old APK response, authorization, and one usage record', async testCase => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(testCase.content) } }],
    })));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'POST', url: `/api/model/${testCase.endpoint}`, payload: testCase.payload });
    expect(response.statusCode).toBe(200);
    expect(response.json().result).toMatchObject(testCase.expected);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      model: 'deepseek-flash', thinking: { type: 'disabled' }, response_format: { type: 'json_object' },
      max_tokens: testCase.maxTokens, temperature: testCase.temperature,
    });
    expect(fetchMock.mock.calls[0][1].body).not.toMatch(/vitest-only-deepseek-key|max_completion_tokens|top_p/);
    expect(assertModelAccess).toHaveBeenCalledOnce();
    expect(assertModelAccess).toHaveBeenCalledWith('test-user', 'mimo-v2.5', testCase.endpoint);
    expect(recordUsage).toHaveBeenCalledOnce();
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      success: true, endpoint: testCase.endpoint, model: 'mimo-v2.5', userId: 'test-user',
    }));
  });

  it('selects capability testing by the text provider even if the image provider is MiMo', async () => {
    config.billImageProvider = 'mimo';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"text":true,"json":true,"vision":true}' } }],
    })));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'POST', url: '/api/model/test-capability', payload: { model: 'mimo-v2.5' } });
    expect(response.statusCode).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    expect(recordUsage).toHaveBeenCalledOnce();
  });

  it.each(textRouteCases)('keeps original authorization ahead of $endpoint provider selection', async testCase => {
    vi.mocked(assertModelAccess).mockRejectedValue(new AppError(403, 'model_not_allowed', 'This model is not allowed for this account'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'POST', url: `/api/model/${testCase.endpoint}`, payload: testCase.payload });
    expect(response.statusCode).toBe(403);
    expect(assertModelAccess).toHaveBeenCalledWith('test-user', 'mimo-v2.5', testCase.endpoint);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it.each(textRouteCases)('records one safe upstream failure for $endpoint without exposing provider details', async testCase => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('PRIVATE_UPSTREAM_ERROR vitest-only-deepseek-key', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'POST', url: `/api/model/${testCase.endpoint}`, payload: testCase.payload });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('deepseek_http_error');
    expect(response.body).not.toMatch(/PRIVATE_|vitest-only-deepseek-key/);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(recordUsage).toHaveBeenCalledOnce();
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      success: false, endpoint: testCase.endpoint, model: 'mimo-v2.5', errorCode: 'deepseek_http_error',
    }));
  });

  it.each(textRouteCases)('rejects incomplete $endpoint structured output with the selected provider error code', async testCase => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ finish_reason: 'length', message: { content: '{"PRIVATE_PARTIAL":' } }],
    })));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'POST', url: `/api/model/${testCase.endpoint}`, payload: testCase.payload });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('deepseek_invalid_result');
    expect(response.body).not.toContain('PRIVATE_');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(recordUsage).toHaveBeenCalledOnce();
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      success: false, endpoint: testCase.endpoint, errorCode: 'deepseek_invalid_result',
    }));
  });

  it('converts text provider network details into one safe recorded failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('PRIVATE_SOCKET vitest-only-deepseek-key'));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'POST', url: '/api/model/parse-transaction', payload: input });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('deepseek_network_error');
    expect(response.body).not.toMatch(/PRIVATE_|vitest-only-deepseek-key/);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(recordUsage).toHaveBeenCalledOnce();
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ success: false, errorCode: 'deepseek_network_error' }));
  });

  it('keeps ASR on MiMo when both text and images use DeepSeek', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { audio: { transcript: '今天买咖啡十八元' } } }],
    })));
    vi.stubGlobal('fetch', fetchMock);
    const response = await app.inject({ method: 'POST', url: '/api/model/transcribe-audio', payload: {
      model: 'mimo-v2.5-asr', durationSeconds: 1, audioDataUrl: 'data:audio/wav;base64,' + 'x'.repeat(100),
    } });
    expect(response.statusCode).toBe(200);
    expect(response.json().result).toEqual({ text: '今天买咖啡十八元' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.xiaomimimo.com/v1/chat/completions');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('mimo-v2.5-asr');
    expect(body).not.toHaveProperty('thinking');
    expect(assertModelAccess).toHaveBeenCalledWith('test-user', 'mimo-v2.5-asr', 'transcribe-audio');
    expect(recordUsage).toHaveBeenCalledOnce();
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      success: true, endpoint: 'transcribe-audio', model: 'mimo-v2.5-asr', audioSeconds: 1,
    }));
  });
});
