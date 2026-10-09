import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({ config: { deepseekApiKey: 'unit-test-deepseek-key' } }));

import { config } from './config.js';
import { callDeepseekChat } from './deepseek.js';

afterEach(() => {
  config.deepseekApiKey = 'unit-test-deepseek-key';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const input = {
  model: 'mimo-v2.5',
  max_completion_tokens: 8192,
  response_format: { type: 'unexpected' },
  temperature: 0.9,
  top_p: 0.9,
  stream: true,
  messages: [
    { role: 'system', content: 'PRIVATE_PROMPT' },
    { role: 'user', content: [
      { type: 'text', text: 'PRIVATE_BILL_TEXT' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,PRIVATE_IMAGE', detail: 'low' } },
    ] },
  ],
};

const mockResponse = (payload: unknown) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const assertSafeFailure = async (promise: Promise<unknown>, expected: Record<string, unknown>) => {
  const failure = await promise.catch(error => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure).toMatchObject(expected);
  if (failure instanceof Error) expect(failure.message).not.toMatch(/PRIVATE_|unit-test-deepseek-key/);
};

describe('server-selected DeepSeek chat provider', () => {
  it('maps caller token and temperature settings while preserving original image detail without mutating input', async () => {
    const fetchMock = mockResponse({ model: 'deepseek-flash', choices: [] });
    const original = JSON.parse(JSON.stringify(input));
    expect(await callDeepseekChat(input)).toEqual({ model: 'deepseek-flash', choices: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    const request = fetchMock.mock.calls[0][1];
    expect(request.headers).toEqual({ Authorization: 'Bearer unit-test-deepseek-key', 'Content-Type': 'application/json' });
    expect(JSON.parse(request.body)).toEqual({
      model: 'deepseek-flash',
      thinking: { type: 'disabled' },
      temperature: 0.9,
      max_tokens: 8192,
      response_format: { type: 'json_object' },
      messages: [
        input.messages[0],
        { role: 'user', content: [
          { type: 'text', text: 'PRIVATE_BILL_TEXT' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,PRIVATE_IMAGE', detail: 'original' } },
        ] },
      ],
    });
    expect(request.body).not.toMatch(/unit-test-deepseek-key|mimo-v2\.5|max_completion_tokens|top_p|stream/);
    expect(input).toEqual(original);
  });

  it.each([undefined, { max_completion_tokens: 2048, temperature: 0.2 }])('preserves text-only messages with caller settings=%s', async settings => {
    const fetchMock = mockResponse({ model: 'deepseek-flash', choices: [] });
    const messages = [
      { role: 'system', content: 'PRIVATE_TEXT_PROMPT' },
      { role: 'user', content: 'PRIVATE_TEXT_INPUT' },
    ];
    const logger = { info: vi.fn() };
    await callDeepseekChat({ model: 'mimo-v2.5', messages, ...settings }, logger);
    expect(fetchMock).toHaveBeenCalledOnce();
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request).toEqual({
      model: 'deepseek-flash', messages, thinking: { type: 'disabled' },
      max_tokens: settings?.max_completion_tokens ?? 4096,
      temperature: settings?.temperature ?? 0.1,
      response_format: { type: 'json_object' },
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/PRIVATE_|unit-test-deepseek-key|Authorization/);
  });

  it.each(['stop', 'length', 'aborted', 'insufficient_system_resource'])('logs only filtered provider metadata with finishReason=%s', async finishReason => {
    mockResponse({
      model: 'deepseek-flash',
      choices: [{ finish_reason: finishReason, message: { content: 'PRIVATE_RESULT', reasoning_content: 'PRIVATE_REASONING' } }],
      usage: { prompt_tokens: 240, completion_tokens: 400, completion_tokens_details: { reasoning_tokens: 0 } },
    });
    const logger = { info: vi.fn() };
    await callDeepseekChat(input, logger);
    expect(logger.info.mock.calls[0][0]).toEqual({
      event: 'deepseek_response', provider: 'deepseek', requestedModel: 'mimo-v2.5', effectiveModel: 'deepseek-flash',
      durationMs: expect.any(Number), responseModel: 'deepseek-flash', finishReason,
      promptTokens: 240, completionTokens: 400, reasoningTokens: 0,
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/PRIVATE_|unit-test-deepseek-key|Authorization|data:image/);
  });

  it('rejects untrusted metadata strings and noninteger or negative token counts from logs', async () => {
    mockResponse({
      model: 'PRIVATE_MODEL text with spaces',
      choices: [{ finish_reason: 'PRIVATE_FINISH_REASON' }],
      usage: { prompt_tokens: -1, completion_tokens: 0.5, completion_tokens_details: { reasoning_tokens: '2' } },
    });
    const logger = { info: vi.fn() };
    await callDeepseekChat(input, logger);
    expect(logger.info.mock.calls[0][0]).toMatchObject({
      responseModel: undefined, finishReason: undefined,
      promptTokens: undefined, completionTokens: undefined, reasoningTokens: undefined,
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('PRIVATE_');
  });

  it.each([null, { choices: null, usage: 'unexpected' }])('handles malformed metadata without exposing raw payloads', async payload => {
    mockResponse(payload);
    const logger = { info: vi.fn() };
    expect(await callDeepseekChat(input, logger)).toEqual(payload);
    expect(logger.info).toHaveBeenCalledOnce();
  });

  it.each([400, 429, 500])('returns a static HTTP %s failure without retries, headers, key, or upstream error text', async status => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('PRIVATE_PROVIDER_ERROR unit-test-deepseek-key', { status }));
    vi.stubGlobal('fetch', fetchMock);
    const logger = { info: vi.fn() };
    await assertSafeFailure(callDeepseekChat(input, logger), {
      statusCode: 502, code: 'deepseek_http_error',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls[0][0]).toMatchObject({ event: 'deepseek_failure', provider: 'deepseek', upstreamStatus: status, errorCode: 'deepseek_http_error' });
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/PRIVATE_|unit-test-deepseek-key|Authorization/);
  });

  it('returns a static invalid JSON failure without parser excerpts or retries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('PRIVATE_INVALID_JSON unit-test-deepseek-key'));
    vi.stubGlobal('fetch', fetchMock);
    const logger = { info: vi.fn() };
    await assertSafeFailure(callDeepseekChat(input, logger), {
      statusCode: 502, code: 'deepseek_invalid_json',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/PRIVATE_|unit-test-deepseek-key/);
  });

  it('converts unexpected network errors into a static failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('PRIVATE_SOCKET unit-test-deepseek-key'));
    vi.stubGlobal('fetch', fetchMock);
    const logger = { info: vi.fn() };
    await assertSafeFailure(callDeepseekChat(input, logger), {
      statusCode: 502, code: 'deepseek_network_error',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/PRIVATE_|unit-test-deepseek-key/);
  });

  it('aborts at the dedicated 90 second deadline without retrying or exposing the abort reason', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('PRIVATE_NETWORK unit-test-deepseek-key', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const logger = { info: vi.fn() };
    const pending = callDeepseekChat(input, logger);
    const rejected = assertSafeFailure(pending, {
      statusCode: 504, code: 'deepseek_timeout',
    });
    await vi.advanceTimersByTimeAsync(89_999);
    expect(logger.info).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls[0][0]).toMatchObject({ event: 'deepseek_failure', durationMs: 90_000, timeoutMs: 90_000, errorCode: 'deepseek_timeout' });
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(/PRIVATE_|unit-test-deepseek-key/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its deadline after success', async () => {
    vi.useFakeTimers();
    mockResponse({ model: 'deepseek-flash' });
    await callDeepseekChat(input);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails without issuing a provider request when the chat key is unavailable', async () => {
    config.deepseekApiKey = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await assertSafeFailure(callDeepseekChat(input), { code: 'deepseek_not_configured', statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
