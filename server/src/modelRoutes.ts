import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from './auth.js';
import { withModelSlot } from './concurrency.js';
import { AppError } from './errors.js';
import { callMimoChat, extractJsonObject, extractModelContent } from './mimo.js';
import { assertModelAccess, recordUsage } from './quota.js';
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

const capabilitySchema = z.object({
  model: modelSchema,
});

const todayISO = () => new Date().toISOString().slice(0, 10);

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
        max_completion_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              `你是记账助手。请从用户输入中提取 JSON：amount, category, paymentMethod, description, detail, date, tag, splitItems。` +
              `splitItems 的每一项可包含 amount, category, description, detail, tag。category 必须属于：${input.categories.join(', ')}。` +
              `description 必须是适合账单列表显示的凝练标题，4 到 12 个中文字符左右，不要写解释。` +
              `detail 用一句稍微更详细的中文说明消费场景、归类依据或拆单依据，避免编造不存在的商户和金额。` +
              `AA 或多人分摊场景只记录用户最终承担的净支出，必须返回单笔账单，不要生成 splitItems。` +
              `金额判断优先级：如果提供了用户实际付款和收到的回款，amount 等于实际付款减去回款；如果提供了实际转账金额，不得强制按人数平均；只有明确说明平均 AA 且没有提供实际回款金额时，才用总金额除以人数。` +
              `示例：“我付了 120，他转我 60”返回 amount 60；“3 个人吃饭花了 300，是 AA 的”返回 amount 100；“两人吃饭 163，我付的，他只转我 80”返回 amount 83。` +
              `今天是 ${todayISO()}。只返回 JSON。`,
          },
          { role: 'user', content: input.text },
        ],
      }));
      const parsed = JSON.parse(extractJsonObject(extractModelContent(payload))) as unknown;
      await recordUsage({ durationMs: Date.now() - startedAt, endpoint, model: input.model, success: true, userId: auth.userId });
      return { result: parsed };
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
          {
            role: 'system',
            content:
              `你是记账截图识别助手。请从截图中提取账单 JSON，只返回 JSON。` +
              `字段：amount, category, paymentMethod, description, detail, date, tag, source, sourceLabel, splitItems。` +
              `splitItems 每项字段：amount, category, description, detail, quantity, tag。category 必须属于：${input.categories.join(', ')}。` +
              `盒马/超市长截图必须逐商品拆单，商品金额取右侧成交价，quantity 必须包含具体数量和单位，例如“3杯”“1袋”“950ml 1盒”。` +
              `淘宝/天猫优先取每个订单的实付款，分别作为 splitItems 记录即可，不需要识别 quantity。` +
              `饮料、咖啡、牛奶、酒水归“饮料”；饭菜、生鲜、水果、零食、冰淇淋、熟食归“餐费”；清洁洗护归“日用”；鞋服归“服饰”。` +
              `tag 请提炼简短账目标签，例如 #饮品补给、#家庭餐食、#日用补给、#衣物鞋履、#线上服务、#盒马采购、#网购订单。` +
              `支付方式看不到时返回空字符串。今天是 ${todayISO()}。`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '识别这张记账截图，返回可直接保存的 JSON。' },
              { type: 'image_url', image_url: { url: input.imageDataUrl } },
            ],
          },
        ],
      }));
      const parsed = JSON.parse(extractJsonObject(extractModelContent(payload))) as unknown;
      await recordUsage({ durationMs: Date.now() - startedAt, endpoint, model: input.model, success: true, userId: auth.userId });
      return { result: parsed };
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
          { role: 'system', content: '你是模型能力测试助手。只返回 JSON：{"text":true,"json":true,"vision":true}。如果无法读取图片，vision 为 false。' },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请确认你能返回 JSON，并判断图片是否可读。' },
              { type: 'image_url', image_url: { url: transparentPixel } },
            ],
          },
        ],
      }));
      const parsed = JSON.parse(extractJsonObject(extractModelContent(payload))) as unknown;
      await recordUsage({ durationMs: Date.now() - startedAt, endpoint, model: input.model, success: true, userId: auth.userId });
      return { result: parsed };
    } catch (error) {
      await recordUsage({ durationMs: Date.now() - startedAt, endpoint, errorCode: error instanceof AppError ? error.code : 'internal_error', model: input.model, success: false, userId: auth.userId });
      throw error;
    }
  });
};
