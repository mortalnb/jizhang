import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from './types.js';

vi.mock('./auth.js', () => ({ requireAuth: async (request: AuthenticatedRequest) => {
  request.auth = { userId: 'test-user', deviceId: 'test-device', sessionId: 'test-session', username: 'test-user' };
} }));
vi.mock('./quota.js', () => ({ assertModelAccess: vi.fn(), recordUsage: vi.fn().mockResolvedValue({}) }));
vi.mock('./billImageInput.js', () => ({ prepareBillImage: vi.fn() }));

import { config } from './config.js';
import { AppError, sendError } from './errors.js';
import { prepareBillImage, type BillImageContentPart } from './billImageInput.js';
import { registerModelRoutes } from './modelRoutes.js';
import { assertModelAccess, recordUsage } from './quota.js';

const app = Fastify();
app.setErrorHandler((error, request, reply) => sendError(reply, error, request.id));
registerModelRoutes(app);
const payload = { model: 'mimo-v2.5', categories: ['其他'], imageDataUrl: 'data:image/jpeg;base64,' + 'a'.repeat(100) };
const parts: BillImageContentPart[] = [
  { type: 'text', text: '连续截图分片，请按真实结算分组。' },
  { type: 'image_url', image_url: { url: 'data:image/png;base64,tile-one' } },
  { type: 'image_url', image_url: { url: 'data:image/png;base64,tile-two' } },
];
const response = () => new Response(JSON.stringify({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: {
  content: JSON.stringify({ transactions: [{ amount: 170.63, category: '其他', description: '测试采购' }] }),
} }] }));

beforeEach(() => {
  vi.mocked(assertModelAccess).mockReset();
  vi.mocked(recordUsage).mockClear();
  vi.mocked(prepareBillImage).mockReset().mockResolvedValue(parts);
  config.billImageProvider = 'deepseek';
  config.deepseekApiKey = 'unit-test-key';
});
afterEach(() => {
  config.billImageProvider = 'mimo';
  config.deepseekApiKey = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => app.close());

describe('image preprocessing authorization and request boundaries', () => {
  it('rejects unauthorized callers before native image preparation', async () => {
    vi.mocked(assertModelAccess).mockRejectedValue(new AppError(403, 'model_not_allowed', 'Not allowed'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await app.inject({ method: 'POST', url: '/api/model/recognize-bill-image', payload });
    expect(result.statusCode).toBe(403);
    expect(prepareBillImage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('sends all prepared fragments in one provider request and records one logical use', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const result = await app.inject({ method: 'POST', url: '/api/model/recognize-bill-image', payload });
    expect(result.statusCode).toBe(200);
    expect(result.json().result.transactions).toHaveLength(1);
    expect(prepareBillImage).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    const content = JSON.parse(fetchMock.mock.calls[0][1].body).messages[1].content;
    expect(content.filter((item: { type: string }) => item.type === 'image_url')).toHaveLength(2);
    expect(content[1]).toEqual(parts[0]);
    expect(recordUsage).toHaveBeenCalledOnce();
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ endpoint: 'recognize-bill-image', model: 'mimo-v2.5', success: true }));
  });

  it('holds the existing image slot during preparation, before any provider request', async () => {
    let release!: (value: typeof parts) => void;
    let notifyStarted!: () => void;
    const started = new Promise<void>(resolve => { notifyStarted = resolve; });
    vi.mocked(prepareBillImage).mockImplementationOnce(() => {
      notifyStarted();
      return new Promise(resolve => { release = resolve; });
    });
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const first = app.inject({ method: 'POST', url: '/api/model/recognize-bill-image', payload });
    await started;
    try {
      const second = await app.inject({ method: 'POST', url: '/api/model/recognize-bill-image', payload });
      expect(second.statusCode).toBe(429);
      expect(second.json().error.code).toBe('model_busy');
      expect(prepareBillImage).toHaveBeenCalledOnce();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      release(parts);
      await first;
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(recordUsage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(recordUsage).mock.calls.filter(([entry]) => entry.success)).toHaveLength(1);
  });

  it('does not call the provider after a clear preprocessing error', async () => {
    vi.mocked(prepareBillImage).mockRejectedValue(new AppError(413, 'bill_image_too_large', '图片过大，请拆分后重试。'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await app.inject({ method: 'POST', url: '/api/model/recognize-bill-image', payload });
    expect(result.statusCode).toBe(413);
    expect(result.json().error.code).toBe('bill_image_too_large');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordUsage).toHaveBeenCalledOnce();
  });

  it('keeps MiMo image requests outside DeepSeek preprocessing', async () => {
    config.billImageProvider = 'mimo';
    const fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    const result = await app.inject({ method: 'POST', url: '/api/model/recognize-bill-image', payload });
    expect(result.statusCode).toBe(200);
    expect(prepareBillImage).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.xiaomimimo.com/v1/chat/completions');
  });
});
