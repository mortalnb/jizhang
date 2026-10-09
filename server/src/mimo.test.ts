import { afterEach, describe, expect, it, vi } from 'vitest';
import { callMimoChat } from './mimo.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mockCompletion = (payload: unknown) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('MiMo proxy compatibility', () => {
  it.each(['text', 'image'])('routes an old APK %s request to Flash without reasoning or changing the JSON contract', async kind => {
    const payload = { model: 'mimo-v2.6-flash', choices: [{ message: { content: '{"transactions":[]}' } }] };
    const fetchMock = mockCompletion(payload);
    const messages = [{ role: 'user', content: kind === 'image' ? [{ type: 'image_url', image_url: { url: 'data:image/png;base64,test' } }] : '咖啡十八元' }];
    const input = {
      model: 'mimo-v2.5', messages, temperature: 0.1,
      max_completion_tokens: 4096, response_format: { type: 'json_object' },
    };
    expect(await callMimoChat(input)).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.xiaomimimo.com/v1/chat/completions');
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toEqual({ ...input, model: 'mimo-v2.6-flash', thinking: { type: 'disabled' } });
    expect(input.model).toBe('mimo-v2.5');
  });

  it('preserves the ASR request exactly', async () => {
    const fetchMock = mockCompletion({ choices: [{ message: { audio: { transcript: '咖啡十八元' } } }] });
    const input = {
      model: 'mimo-v2.5-asr',
      asr_options: { language: 'zh' as const },
      messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,test' } }] }],
    };
    await callMimoChat(input);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });

  it('also disables reasoning when Flash is requested explicitly', async () => {
    const fetchMock = mockCompletion({});
    await callMimoChat({ model: 'mimo-v2.6-flash', messages: [] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: 'mimo-v2.6-flash', messages: [], thinking: { type: 'disabled' },
    });
  });

  it('preserves other explicitly allowed models', async () => {
    const fetchMock = mockCompletion({});
    const input = { model: 'mimo-v2.6-pro', messages: [], max_completion_tokens: 2048 };
    await callMimoChat(input);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });

  it('logs only provider metadata, including truncation, without content or reasoning', async () => {
    mockCompletion({
      model: 'mimo-v2.6-flash',
      choices: [{ finish_reason: 'length', message: { content: 'private-bill-content', reasoning_content: 'private-reasoning' } }],
      usage: { prompt_tokens: 30, completion_tokens: 4096, completion_tokens_details: { reasoning_tokens: 0 } },
    });
    const logger = { info: vi.fn() };
    await callMimoChat({ model: 'mimo-v2.5', messages: [{ role: 'user', content: 'private-input' }] }, logger);
    const metadata = logger.info.mock.calls[0][0];
    expect(metadata).toEqual({
      event: 'mimo_response', requestedModel: 'mimo-v2.5', effectiveModel: 'mimo-v2.6-flash',
      durationMs: expect.any(Number), responseModel: 'mimo-v2.6-flash', finishReason: 'length',
      promptTokens: 30, completionTokens: 4096, reasoningTokens: 0,
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('private-');
  });

  it.each([null, { choices: null, usage: 'unexpected' }])('does not fail while logging malformed response metadata', async payload => {
    mockCompletion(payload);
    const logger = { info: vi.fn() };
    expect(await callMimoChat({ model: 'mimo-v2.5', messages: [] }, logger)).toEqual(payload);
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it('keeps upstream HTTP failures as failures without retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('upstream failure', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(callMimoChat({ model: 'mimo-v2.5', messages: [] })).rejects.toMatchObject({ code: 'mimo_http_error', statusCode: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 180_000])('aborts at the selected deadline (%s) without retrying or exposing upstream content', async timeoutMs => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('PRIVATE_NETWORK_DETAIL', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const logger = { info: vi.fn() };
    const promise = callMimoChat({ model: 'mimo-v2.5', messages: [{ role: 'user', content: 'PRIVATE_IMAGE' }] }, logger, { timeoutMs });
    const rejected = expect(promise).rejects.toMatchObject({ code: 'mimo_timeout', statusCode: 504 });
    await vi.advanceTimersByTimeAsync((timeoutMs ?? 90_000) - 1);
    expect(logger.info).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls[0][0]).toMatchObject({ event: 'mimo_failure', durationMs: timeoutMs ?? 90_000, timeoutMs: timeoutMs ?? 90_000, errorCode: 'mimo_timeout' });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('PRIVATE_');
  });

  it('logs HTTP status without provider error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('PRIVATE_PROVIDER_ERROR', { status: 429 })));
    const logger = { info: vi.fn() };
    await expect(callMimoChat({ model: 'mimo-v2.5', messages: [] }, logger)).rejects.toMatchObject({ code: 'mimo_http_error' });
    expect(logger.info.mock.calls[0][0]).toMatchObject({ event: 'mimo_failure', upstreamStatus: 429, errorCode: 'mimo_http_error' });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('PRIVATE_');
  });
});
