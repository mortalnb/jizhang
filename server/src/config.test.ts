import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.mocked(readFileSync).mockReset();
  vi.stubEnv('BILL_IMAGE_PROVIDER', 'mimo');
  vi.stubEnv('TEXT_MODEL_PROVIDER', 'mimo');
  vi.stubEnv('DEEPSEEK_API_KEY', '');
  vi.stubEnv('DEEPSEEK_API_KEY_FILE', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('image and text provider startup configuration', () => {
  it('defaults to MiMo and does not read an unused DeepSeek credential file', async () => {
    vi.stubEnv('BILL_IMAGE_PROVIDER', '');
    vi.stubEnv('TEXT_MODEL_PROVIDER', '');
    vi.stubEnv('DEEPSEEK_API_KEY_FILE', '/private/unused');
    const { config } = await import('./config.js');
    expect(config.billImageProvider).toBe('mimo');
    expect(config.textModelProvider).toBe('mimo');
    expect(config.deepseekApiKey).toBeUndefined();
    expect(readFileSync).not.toHaveBeenCalled();
  });
  it('accepts an explicit DeepSeek environment credential', async () => {
    vi.stubEnv('BILL_IMAGE_PROVIDER', 'deepseek');
    vi.stubEnv('DEEPSEEK_API_KEY', ' dummy-only-key ');
    const { config } = await import('./config.js');
    expect(config.deepseekApiKey).toBe('dummy-only-key');
  });
  it.each(['environment', 'mounted-file'])('loads a DeepSeek %s credential when only text uses DeepSeek', async source => {
    vi.stubEnv('TEXT_MODEL_PROVIDER', 'deepseek');
    if (source === 'environment') vi.stubEnv('DEEPSEEK_API_KEY', ' text-only-dummy-key ');
    else {
      vi.stubEnv('DEEPSEEK_API_KEY_FILE', '/run/secrets/text-test-credential');
      vi.mocked(readFileSync).mockReturnValue('\uFEFFtext-only-dummy-key\n');
    }
    const { config } = await import('./config.js');
    expect(config.billImageProvider).toBe('mimo');
    expect(config.textModelProvider).toBe('deepseek');
    expect(config.deepseekApiKey).toBe('text-only-dummy-key');
    if (source === 'environment') expect(readFileSync).not.toHaveBeenCalled();
    else expect(readFileSync).toHaveBeenCalledOnce();
  });
  it('loads a shared mounted credential once when both image and text use DeepSeek', async () => {
    vi.stubEnv('BILL_IMAGE_PROVIDER', 'deepseek');
    vi.stubEnv('TEXT_MODEL_PROVIDER', 'deepseek');
    vi.stubEnv('DEEPSEEK_API_KEY_FILE', '/run/secrets/shared-test-credential');
    vi.mocked(readFileSync).mockReturnValue('shared-dummy-key\n');
    const { config } = await import('./config.js');
    expect(config.deepseekApiKey).toBe('shared-dummy-key');
    expect(readFileSync).toHaveBeenCalledOnce();
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
  it('rejects an unsupported text provider instead of silently selecting a model', async () => {
    vi.stubEnv('TEXT_MODEL_PROVIDER', 'unexpected');
    await expect(import('./config.js')).rejects.toThrow('TEXT_MODEL_PROVIDER must be mimo or deepseek');
  });
  it('requires a credential only when DeepSeek is selected', async () => {
    vi.stubEnv('BILL_IMAGE_PROVIDER', 'deepseek');
    await expect(import('./config.js')).rejects.toThrow('Missing required environment variable DEEPSEEK_API_KEY');
  });
  it('requires a credential when only text selects DeepSeek', async () => {
    vi.stubEnv('TEXT_MODEL_PROVIDER', 'deepseek');
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
