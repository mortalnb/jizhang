import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from './auth.js';
import { withModelSlot } from './concurrency.js';
import { AppError } from './errors.js';
import { callMimoChat, extractJsonObject, extractModelContent } from './mimo.js';
import { buildTransactionPrompt, buildVisionPrompt, normalizeModelBatch, normalizeVisionBatch } from './modelContracts.js';
import { assertModelAccess, recordUsage } from './quota.js';
import { todayISOChina } from './time.js';
import type { AuthenticatedRequest } from './types.js';

const modelSchema = z.string().min(1).max(80).default('mimo-v2.5');
const categoriesSchema = z.array(z.string().min(1).max(20)).min(1).max(80);

const parseTextSchema = z.object({
  categories: categoriesSchema,
  model: modelSchema,
  text: z.string().min(1).max(6000),
});

const imageSchema = z.object({
  categories: categoriesSchema,
  imageDataUrl: z.string().min(100).max(7_000_000),
  model: modelSchema,
});

const audioSchema = z.object({
  audioDataUrl: z.string().min(100).max(10_000_000).regex(/^data:audio\/(?:wav|x-wav|mpeg|mp3);base64,/i),
  durationSeconds: z.coerce.number().min(0.4).max(60.5),
  language: z.enum(['auto', 'zh', 'en']).default('zh'),
  model: z.literal('mimo-v2.5-asr'),
});

const capabilitySchema = z.object({ model: modelSchema });
const analysisObject = z.record(z.string().max(80), z.unknown());
const ledgerAnalysisSchema = z.object({
  financialFacts: analysisObject,
  model: modelSchema,
  monthSummaries: z.array(analysisObject).max(12),
  recentTransactions: z.array(z.object({
    amount: z.number().finite().nonnegative(),
    category: z.string().min(1).max(20),
    date: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/),
    description: z.string().min(1).max(120),
    tag: z.string().max(40).optional(),
  })).max(30),
  requirements: z.array(z.string().min(1).max(240)).min(1).max(12),
});
const insightResultSchema = z.object({
  insights: z.array(z.object({
    body: z.string().min(1).max(180),
    title: z.string().min(1).max(24),
    tone: z.enum(['info', 'warn', 'success']),
  })).min(1).max(5),
});

const parseModelJson = (payload: unknown) => JSON.parse(extractJsonObject(extractModelContent(payload))) as unknown;

const validated = <T>(work: () => T) => {
  try {
    return work();
  } catch {
    throw new AppError(502, 'mimo_invalid_result', 'MiMo returned a result that does not match the ledger contract');
  }
};
export const registerModelRoutes = (app: FastifyInstance) => {
  app.post('/api/model/parse-transaction', { preHandler: requireAuth }, async request => {
    const auth = (request as AuthenticatedRequest).auth;
    const input = parseTextSchema.parse(request.body);
    const endpoint = 'parse-transaction';
    await assertModelAccess(auth.userId, input.model, endpoint);
    const startedAt = Date.now();
    try {
      const payload = await withModelSlot('text', () => callMimoChat({
        model: input.model,
        temperature: 0.1,
        max_completion_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildTransactionPrompt(input.categories, todayISOChina()) },
          { role: 'user', content: input.text },
        ],
      }));
      const result = validated(() => normalizeModelBatch(parseModelJson(payload), input.categories));
      await recordUsage({ durationMs: Date.now() - startedAt, endpoint, model: input.model, success: true, userId: auth.userId });
      return { result };
    } catch (error) {
      await recordUsage({ durationMs: Date.now() - startedAt, endpoint, errorCode: error instanceof AppError ? error.code : 'internal_error', model: input.model, success: false, userId: auth.userId });
      throw error;
    }
  });

  app.post('/api/model/recognize-bill-image', { preHandler: requireAuth }, async request => {
    const auth = (request as AuthenticatedRequest).auth;
    const input = imageSchema.parse(request.body);
    const endpoint = 'recognize-bill-image';
    await assertModelAccess(auth.userId, input.model, endpoint);
    const startedAt = Date.now();
    try {
      const payload = await withModelSlot('image', () => callMimoChat({
        model: input.model,
        temperature: 0.1,
        top_p: 0.9,
        max_completion_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildVisionPrompt(input.categories, todayISOChina()) },
          {
            role: 'user',
            content: [
              { type: 'text', text: '识别这张记账截图，按一次结账与独立订单边界返回 JSON。' },
              { type: 'image_url', image_url: { url: input.imageDataUrl } },
            ],
          },
        ],
      }));
      const result = validated(() => normalizeVisionBatch(parseModelJson(payload), input.categories));
      await recordUsage({ durationMs: Date.now() - startedAt, endpoint, model: input.model, success: true, userId: auth.userId });
      return { result };
    } catch (error) {
      await recordUsage({ durationMs: Date.now() - startedAt, endpoint, errorCode: error instanceof AppError ? error.code : 'internal_error', model: input.model, success: false, userId: auth.userId });
      throw error;
    }
  });

  app.post('/api/model/transcribe-audio', { preHandler: requireAuth }, async request => {
    const auth = (request as AuthenticatedRequest).auth;
    const input = audioSchema.parse(request.body);
    const endpoint = 'transcribe-audio';
    await assertModelAccess(auth.userId, input.model, endpoint);
    const startedAt = Date.now();
    try {
      const payload = await withModelSlot('audio', () => callMimoChat({
        model: input.model,
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: input.audioDataUrl } }] }],
        asr_options: { language: input.language },
      }));
      const text = extractModelContent(payload).trim();
      if (!text) throw new AppError(502, 'mimo_empty_transcript', 'MiMo ASR returned an empty transcript');
      await recordUsage({ audioSeconds: Math.ceil(input.durationSeconds), durationMs: Date.now() - startedAt, endpoint, model: input.model, success: true, userId: auth.userId });
      return { result: { text } };
    } catch (error) {
      await recordUsage({ audioSeconds: Math.ceil(input.durationSeconds), durationMs: Date.now() - startedAt, endpoint, errorCode: error instanceof AppError ? error.code : 'internal_error', model: input.model, success: false, userId: auth.userId });
      throw error;
    }
  });

  app.post('/api/model/analyze-ledger', { preHandler: requireAuth }, async request => {
    const auth = (request as AuthenticatedRequest).auth;
    const input = ledgerAnalysisSchema.parse(request.body);
    const endpoint = 'analyze-ledger';
    await assertModelAccess(auth.userId, input.model, endpoint);
    const startedAt = Date.now();
    try {
      const payload = await withModelSlot('text', () => callMimoChat({
        model: input.model,
        temperature: 0.2,
        max_completion_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是私人记账分析助手。只允许引用输入 JSON 中明确存在的数据，不估算、不补全、不编造。禁止把不完整月份与完整月份直接比较，不分析商户，不推断消费动机、因果或价值判断。必须返回 JSON：{"insights":[{"title":"短标题","body":"一句具体分析或建议","tone":"info|warn|success"}]}。',
          },
          { role: 'user', content: JSON.stringify({ financialFacts: input.financialFacts, monthSummaries: input.monthSummaries, recentTransactions: input.recentTransactions, requirements: input.requirements }) },
        ],
      }));
      const result = validated(() => insightResultSchema.parse(parseModelJson(payload)));
      await recordUsage({ durationMs: Date.now() - startedAt, endpoint, model: input.model, success: true, userId: auth.userId });
      return { result };
    } catch (error) {
      await recordUsage({ durationMs: Date.now() - startedAt, endpoint, errorCode: error instanceof AppError ? error.code : 'internal_error', model: input.model, success: false, userId: auth.userId });
      throw error;
    }
  });

  app.post('/api/model/test-capability', { preHandler: requireAuth }, async request => {
    const auth = (request as AuthenticatedRequest).auth;
    const input = capabilitySchema.parse(request.body);
    const endpoint = 'test-capability';
    await assertModelAccess(auth.userId, input.model, endpoint);
    const startedAt = Date.now();
    const transparentPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
    try {
      const payload = await withModelSlot('text', () => callMimoChat({
        model: input.model,
        temperature: 0.1,
        max_completion_tokens: 1024,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '只返回 JSON：{"text":true,"json":true,"vision":true}。如果无法读取图片，vision 为 false。' },
          { role: 'user', content: [{ type: 'text', text: '确认 JSON 和图片能力。' }, { type: 'image_url', image_url: { url: transparentPixel } }] },
        ],
      }));
      const parsed = validated(() => parseModelJson(payload)) as Record<string, unknown>;
      await recordUsage({ durationMs: Date.now() - startedAt, endpoint, model: input.model, success: true, userId: auth.userId });
      return { result: { ...parsed, audio: true } };
    } catch (error) {
      await recordUsage({ durationMs: Date.now() - startedAt, endpoint, errorCode: error instanceof AppError ? error.code : 'internal_error', model: input.model, success: false, userId: auth.userId });
      throw error;
    }
  });
};
