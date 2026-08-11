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

export const callMimoChat = async (body: ChatRequest) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.mimoApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new AppError(502, 'mimo_http_error', `MiMo request failed with HTTP ${response.status}`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AppError(502, 'mimo_invalid_json', 'MiMo returned invalid JSON');
    }
  } catch (error) {
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
