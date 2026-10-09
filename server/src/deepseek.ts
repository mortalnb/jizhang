import type { FastifyBaseLogger } from 'fastify';
import { config } from './config.js';
import { AppError } from './errors.js';

interface VisionChatRequest {
  messages: unknown[];
  model: string;
  max_completion_tokens?: number;
  response_format?: unknown;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const tokenCount = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

const responseMetadata = (payload: unknown) => {
  const value = record(payload);
  const choice = record(Array.isArray(value.choices) ? value.choices[0] : undefined);
  const usage = record(value.usage);
  const completionDetails = record(usage.completion_tokens_details);
  return {
    responseModel: typeof value.model === 'string' && /^[\w.:-]{1,80}$/.test(value.model) ? value.model : undefined,
    finishReason: typeof choice.finish_reason === 'string' && ['stop', 'length', 'tool_calls', 'content_filter', 'aborted', 'insufficient_system_resource'].includes(choice.finish_reason) ? choice.finish_reason : undefined,
    promptTokens: tokenCount(usage.prompt_tokens),
    completionTokens: tokenCount(usage.completion_tokens),
    reasoningTokens: tokenCount(completionDetails.reasoning_tokens),
  };
};

const withOriginalImageDetail = (message: unknown) => {
  const value = record(message);
  if (!Array.isArray(value.content)) return message;
  return {
    ...value,
    content: value.content.map(item => {
      const part = record(item);
      return part.type === 'image_url'
        ? { ...part, image_url: { ...record(part.image_url), detail: 'original' } }
        : item;
    }),
  };
};

export const callDeepseekVisionChat = async (body: VisionChatRequest, logger?: Pick<FastifyBaseLogger, 'info'>) => {
  const effectiveModel = 'deepseek-flash';
  const timeoutMs = 90_000;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let upstreamStatus: number | undefined;
  try {
    if (!config.deepseekApiKey) throw new AppError(503, 'deepseek_not_configured', 'Image recognition provider is not configured');
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.deepseekApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: effectiveModel,
        messages: body.messages.map(withOriginalImageDetail),
        thinking: { type: 'disabled' },
        temperature: 0.1,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      }),
    });
    upstreamStatus = response.status;
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new AppError(502, 'deepseek_http_error', 'Image recognition provider returned an HTTP error');
    }
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new AppError(502, 'deepseek_invalid_json', 'Image recognition provider returned invalid JSON');
    }
    logger?.info({
      event: 'deepseek_response', provider: 'deepseek', requestedModel: body.model, effectiveModel,
      durationMs: Date.now() - startedAt,
      ...responseMetadata(payload),
    }, 'Image recognition response metadata');
    return payload;
  } catch (error) {
    const failure = error instanceof AppError
      ? error
      : error instanceof Error && error.name === 'AbortError'
        ? new AppError(504, 'deepseek_timeout', 'Image recognition provider request timed out')
        : new AppError(502, 'deepseek_network_error', 'Image recognition provider request failed');
    logger?.info({
      event: 'deepseek_failure', provider: 'deepseek', requestedModel: body.model, effectiveModel,
      durationMs: Date.now() - startedAt, timeoutMs, upstreamStatus, errorCode: failure.code,
    }, 'Image recognition request failed');
    throw failure;
  } finally {
    clearTimeout(timeout);
  }
};
