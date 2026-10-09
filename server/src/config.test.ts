import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.mocked(readFileSync).mockReset();
  vi.stubEnv('BILL_IMAGE_PROVIDER', 'mimo');
  vi.stubEnv('DEEPSEEK_API_KEY', '');
  vi.stubEnv('DEEPSEEK_API_KEY_FILE', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('image provider startup configuration', () => {
  it('defaults to MiMo and does not read an unused DeepSeek credential file', async () => {
    vi.stubEnv('BILL_IMAGE_PROVIDER', '');
    vi.stubEnv('DEEPSEEK_API_KEY_FILE', '/private/unused');
    const { config } = await import('./config.js');
    expect(config.billImageProvider).toBe('mimo');
    expect(config.deepseekApiKey).toBeUndefined();
    expect(readFileSync).not.toHaveBeenCalled();
  });
  it('accepts an explicit DeepSeek environment credential', async () => {
    vi.stubEnv('BILL_IMAGE_PROVIDER', 'deepseek');
    vi.stubEnv('DEEPSEEK_API_KEY', ' dummy-only-key ');
    const { config } = await import('./config.js');
    expect(config.deepseekApiKey).toBe('dummy-only-key');
  });
  it('reads a mounted credential internally with BOM and surrounding whitespace removed', async () => {
    vi.stubEnv('BILL_IMAGE_PROVIDER', 'deepseek');
    vi.stubEnv('DEEPSEEK_API_KEY_FILE', '/run/secrets/test-credential');
    vi.mocked(readFileSync).mockReturnValue('\uFEFFdummy-only-key\n');
    const { config } = await import('./config.js');
    expect(config.deepseekApiKey).toBe('dummy-only-key');
    expect(readFileSync).toHaveBeenCalledWith('/run/secrets/test-credential', 'utf8');
  });
  it('rejects an unsupported provider instead of silently selecting a model', async () => {
    vi.stubEnv('BILL_IMAGE_PROVIDER', 'unexpected');
    await expect(import('./config.js')).rejects.toThrow('BILL_IMAGE_PROVIDER must be mimo or deepseek');
  });
  it('requires a credential only when DeepSeek is selected', async () => {
    vi.stubEnv('BILL_IMAGE_PROVIDER', 'deepseek');
    await expect(import('./config.js')).rejects.toThrow('Missing required environment variable DEEPSEEK_API_KEY');
  });
  it.each(['empty', 'unreadable'])('keeps %s credential failure diagnostics static', async mode => {
    vi.stubEnv('BILL_IMAGE_PROVIDER', 'deepseek');
    vi.stubEnv('DEEPSEEK_API_KEY_FILE', '/private/test-file');
    if (mode === 'empty') vi.mocked(readFileSync).mockReturnValue(' \n');
    else vi.mocked(readFileSync).mockImplementation(() => { throw new Error('private filesystem detail'); });
    await expect(import('./config.js')).rejects.toThrow('DeepSeek credential file is unavailable or empty');
  });
});
