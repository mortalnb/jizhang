import type { FastifyBaseLogger } from 'fastify';
import { config } from './config.js';
import { AppError } from './errors.js';

interface ChatRequest {
  asr_options?: { language?: 'auto' | 'zh' | 'en' };
  max_completion_tokens?: number;
  messages: unknown[];
  model: string;
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
    finishReason: typeof choice.finish_reason === 'string' && ['stop', 'length', 'tool_calls', 'content_filter', 'repetition_truncation'].includes(choice.finish_reason) ? choice.finish_reason : undefined,
    promptTokens: tokenCount(usage.prompt_tokens),
    completionTokens: tokenCount(usage.completion_tokens),
    reasoningTokens: tokenCount(completionDetails.reasoning_tokens),
  };
};

export const callMimoChat = async (body: ChatRequest, logger?: Pick<FastifyBaseLogger, 'info'>, options: { timeoutMs?: number } = {}) => {
  // Authorize the APK's requested name in the route before resolving this alias.
  const effectiveModel = body.model === 'mimo-v2.5' ? 'mimo-v2.6-flash' : body.model;
  const upstreamBody = {
    ...body,
    model: effectiveModel,
    ...(effectiveModel === 'mimo-v2.6-flash' ? { thinking: { type: 'disabled' } } : {}),
  };
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 90_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let upstreamStatus: number | undefined;
  try {
    const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.mimoApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upstreamBody),
    });
    upstreamStatus = response.status;
    const text = await response.text();
    if (!response.ok) throw new AppError(502, 'mimo_http_error', `MiMo request failed with HTTP ${response.status}`);
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new AppError(502, 'mimo_invalid_json', 'MiMo returned invalid JSON');
    }
    logger?.info({
      event: 'mimo_response',
      requestedModel: body.model,
      effectiveModel,
      durationMs: Date.now() - startedAt,
      ...responseMetadata(payload),
    }, 'MiMo response metadata');
    return payload;
  } catch (error) {
    logger?.info({
      event: 'mimo_failure', requestedModel: body.model, effectiveModel,
      durationMs: Date.now() - startedAt, timeoutMs, upstreamStatus,
      errorCode: error instanceof AppError ? error.code : error instanceof Error && error.name === 'AbortError' ? 'mimo_timeout' : 'mimo_network_error',
    }, 'MiMo request failed');
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new AppError(504, 'mimo_timeout', 'MiMo request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const extractModelContent = (payload: unknown) => {
  const value = payload as { choices?: Array<{ message?: { audio?: { transcript?: unknown }; content?: unknown; reasoning_content?: unknown } }> };
  const message = value.choices?.[0]?.message;
  if (typeof message?.content === 'string' && message.content.trim()) return message.content;
  if (Array.isArray(message?.content)) {
    const text = message.content
      .map(item => item && typeof item === 'object' && 'text' in item ? String((item as { text?: unknown }).text ?? '') : '')
      .join('')
      .trim();
    if (text) return text;
  }
  const fallback = message?.audio?.transcript ?? message?.reasoning_content;
  if (typeof fallback === 'string' && fallback.trim()) return fallback;
  throw new AppError(502, 'mimo_empty_content', 'MiMo returned empty content');
};

export const extractJsonObject = (value: string) => {
  const cleaned = value.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new AppError(502, 'mimo_non_json', 'MiMo response is not a JSON object');
  return cleaned.slice(start, end + 1);
};
