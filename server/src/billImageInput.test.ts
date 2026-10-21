import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  metadata: { format: 'jpeg', width: 1440, height: 9623, channels: 3 } as Record<string, unknown>,
  metadataError: undefined as Error | undefined,
  cropError: undefined as Error | undefined,
  outputs: [] as Buffer[],
  requests: [] as Array<{ options: unknown; steps: string[]; region?: { left: number; top: number; width: number; height: number } }>,
  active: 0,
  peakActive: 0,
}));

vi.mock('sharp', () => {
  const factory = vi.fn((_input: Buffer, options: unknown) => {
    const request: typeof fake.requests[number] = { options, steps: [] };
    fake.requests.push(request);
    const image = {
      timeout: vi.fn((options: { seconds: number }) => {
        request.steps.push(`timeout:${options.seconds}`);
        return image;
      }),
      metadata: vi.fn(async () => {
        if (fake.metadataError) throw fake.metadataError;
        return fake.metadata;
      }),
      autoOrient: vi.fn(() => { request.steps.push('autoOrient'); return image; }),
      extract: vi.fn((region: NonNullable<typeof request.region>) => {
        request.steps.push('extract');
        request.region = region;
        return image;
      }),
      png: vi.fn(() => { request.steps.push('png'); return image; }),
      toBuffer: vi.fn(async () => {
        fake.active += 1;
        fake.peakActive = Math.max(fake.peakActive, fake.active);
        try {
          await Promise.resolve();
          if (fake.cropError) throw fake.cropError;
          return fake.outputs.shift() ?? Buffer.from('synthetic-png');
        } finally {
          fake.active -= 1;
        }
      }),
    };
    return image;
  });
  return { default: Object.assign(factory, { cache: vi.fn(), concurrency: vi.fn() }) };
});

import sharp from 'sharp';
import { AppError } from './errors.js';
import { planBillImageTiles, prepareBillImage } from './billImageInput.js';

const sourceUrl = `data:image/jpeg;base64,${Buffer.from('synthetic-source-jpeg').toString('base64')}`;

beforeEach(() => {
  fake.metadata = { format: 'jpeg', width: 1440, height: 9623, channels: 3 };
  fake.metadataError = undefined;
  fake.cropError = undefined;
  fake.outputs = [];
  fake.requests = [];
  fake.active = 0;
  fake.peakActive = 0;
  vi.mocked(sharp).mockClear();
});

afterEach(() => { vi.restoreAllMocks(); });

describe('bounded long-image layout', () => {
  it('keeps 8192 unchanged and splits 8193 without losing rows', () => {
    expect(planBillImageTiles(1440, 8192)).toEqual([{ left: 0, top: 0, width: 1440, height: 8192 }]);
    const tiles = planBillImageTiles(1440, 8193);
    expect(tiles).toHaveLength(3);
    expect(tiles[0].top).toBe(0);
    expect(tiles.at(-1)!.top + tiles.at(-1)!.height).toBe(8193);
    tiles.forEach((tile, index) => {
      expect(tile.height).toBeLessThanOrEqual(4096);
      if (index) expect(tiles[index - 1].top + tiles[index - 1].height - tile.top).toBe(192);
    });
  });

  it('covers a 9623-row image in three balanced original-width pieces', () => {
    const tiles = planBillImageTiles(1440, 9623);
    expect(tiles).toEqual([
      { left: 0, top: 0, width: 1440, height: 3336 },
      { left: 0, top: 3144, width: 1440, height: 3336 },
      { left: 0, top: 6288, width: 1440, height: 3335 },
    ]);
    const coverage = new Uint8Array(9623);
    for (const tile of tiles) for (let row = tile.top; row < tile.top + tile.height; row += 1) coverage[row] += 1;
    expect([...coverage].every(count => count === 1 || count === 2)).toBe(true);
    expect([...coverage].filter(count => count === 2)).toHaveLength(384);
  });

  it('allows six bounded pieces and rejects a seventh before allocation', () => {
    expect(planBillImageTiles(1, 23_616)).toHaveLength(6);
    expect(() => planBillImageTiles(1, 23_617)).toThrow(expect.objectContaining({ statusCode: 400, code: 'bill_image_too_long' }));
  });

  it.each([[0, 1], [1, -1], [1.5, 10], [Number.NaN, 1]])('rejects invalid dimensions %s/%s', (width, height) => {
    expect(() => planBillImageTiles(width, height)).toThrow(AppError);
  });

  it('rejects excessive displayed width and pixels without silently resizing', () => {
    expect(() => planBillImageTiles(8193, 1)).toThrow(expect.objectContaining({ code: 'bill_image_too_wide' }));
    expect(() => planBillImageTiles(1440, 11_112)).toThrow(expect.objectContaining({ code: 'bill_image_too_large' }));
  });
});

describe('bill-image preparation without a provider call', () => {
  it('disables the native cache and restricts native concurrency', () => {
    expect(sharp.cache).toHaveBeenCalledWith(false);
    expect(sharp.concurrency).toHaveBeenCalledWith(1);
  });

  it.each(['jpeg', 'jpg', 'png', 'webp', 'gif'])('returns an ordinary static %s data URL byte-for-byte unchanged', async mime => {
    const format = mime === 'jpg' ? 'jpeg' : mime;
    fake.metadata = { format, width: 1440, height: 8192, channels: 3, pages: 1 };
    const url = sourceUrl.replace('image/jpeg', `image/${mime}`);
    expect(await prepareBillImage(url)).toEqual([{ type: 'image_url', image_url: { url } }]);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0].region).toBeUndefined();
  });

  it('adds ordered same-source instructions and serial lossless crops with no resize', async () => {
    const logger = { info: vi.fn() };
    fake.outputs = [Buffer.from('png-1'), Buffer.from('png-2'), Buffer.from('png-3')];
    const parts = await prepareBillImage(sourceUrl, logger);
    const images = parts.filter(part => part.type === 'image_url');
    expect(images).toEqual([1, 2, 3].map(index => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(`png-${index}`).toString('base64')}` } })));
    expect(parts[0]).toMatchObject({ type: 'text', text: expect.stringContaining('同一张长截图') });
    expect(parts[0]).toMatchObject({ text: expect.stringContaining('不同位置出现的同名商品不能因此合并') });
    expect(parts[0]).toMatchObject({ text: expect.stringContaining('独立付款边界') });
    expect(parts.map(part => part.type)).toEqual(['text', 'text', 'image_url', 'text', 'image_url', 'text', 'image_url']);
    expect(parts[1]).toMatchObject({ text: expect.stringContaining('y=0 至 3335') });
    expect(parts[5]).toMatchObject({ text: expect.stringContaining('y=6288 至 9622') });
    expect(fake.requests.slice(1).map(request => request.region)).toEqual(planBillImageTiles(1440, 9623));
    for (const request of fake.requests) {
      expect(request.options).toMatchObject({ limitInputPixels: 16_000_000, failOn: 'warning' });
      expect(request.steps.some(step => /^timeout:(?:[1-9]|1\d|20)$/.test(step))).toBe(true);
    }
    for (const request of fake.requests.slice(1)) expect(request.steps.slice(0, 3)).toEqual(['autoOrient', 'extract', 'png']);
    expect(fake.peakActive).toBe(1);
    expect(logger.info).toHaveBeenCalledWith({
      event: 'bill_image_prepared', format: 'jpeg', width: 1440, height: 9623, pixels: 13_857_120,
      inputBytes: Buffer.from('synthetic-source-jpeg').length, tileCount: 3, outputBytes: 15, prepMs: expect.any(Number),
    }, 'Bill image input prepared');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(sourceUrl);
  });

  it('uses the displayed EXIF orientation before extracting coordinates', async () => {
    fake.metadata = { format: 'jpeg', width: 9623, height: 1440, channels: 3, orientation: 6 };
    await prepareBillImage(sourceUrl);
    expect(fake.requests.slice(1).map(request => request.region)).toEqual(planBillImageTiles(1440, 9623));
    fake.metadata = { format: 'jpeg', width: 1440, height: 9623, channels: 3, orientation: 6 };
    await expect(prepareBillImage(sourceUrl)).rejects.toMatchObject({ code: 'bill_image_too_wide' });
  });

  it.each([
    'https://example.test/image.jpg',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/jpeg;base64,',
    'data:image/jpeg;base64,AAAA=',
    'data:image/jpeg;base64,AB==',
    'data:image/jpeg;base64,AA=/',
    'data:image/jpeg;base64,AA==\n',
    'data:image/jpeg;base64,AA-_',
  ])('rejects malformed or unsupported data URLs before decoding', async url => {
    await expect(prepareBillImage(url)).rejects.toMatchObject({ statusCode: 400, code: 'bill_image_invalid' });
    expect(sharp).not.toHaveBeenCalled();
  });

  it('enforces the existing seven-million-character input limit', async () => {
    await expect(prepareBillImage('A'.repeat(7_000_001))).rejects.toMatchObject({ code: 'bill_image_input_too_large' });
    expect(sharp).not.toHaveBeenCalled();
  });

  it.each([
    { format: 'tiff' },
    { format: 'png' },
    { width: 0 },
    { height: 0 },
    { channels: 0 },
    { channels: 5 },
    { orientation: 9 },
  ])('rejects unsupported, mismatched or incomplete metadata %s', async patch => {
    Object.assign(fake.metadata, patch);
    await expect(prepareBillImage(sourceUrl)).rejects.toMatchObject({ statusCode: 400, code: 'bill_image_invalid' });
  });

  it('rejects excessive pixels and multi-frame images before cropping', async () => {
    fake.metadata.height = 11_112;
    await expect(prepareBillImage(sourceUrl)).rejects.toMatchObject({ code: 'bill_image_too_large' });
    fake.metadata = { format: 'gif', width: 1440, height: 100, channels: 4, pages: 2 };
    await expect(prepareBillImage(sourceUrl.replace('image/jpeg', 'image/gif'))).rejects.toMatchObject({ code: 'bill_image_animated' });
    expect(fake.requests.every(request => !request.region)).toBe(true);
  });

  it('rejects excess output before encoding or preparing another tile', async () => {
    fake.outputs = [Buffer.alloc(8 * 1024 * 1024 + 1)];
    await expect(prepareBillImage(sourceUrl)).rejects.toMatchObject({ code: 'bill_image_output_too_large' });
    expect(fake.requests.filter(request => request.region)).toHaveLength(1);
  });

  it.each(['metadata', 'crop'])('converts private native %s errors into a static error', async stage => {
    const logger = { info: vi.fn() };
    const nativeError = new Error('PRIVATE_NATIVE_ERROR /private/path private-image-content');
    if (stage === 'metadata') fake.metadataError = nativeError;
    else fake.cropError = nativeError;
    const failure = await prepareBillImage(sourceUrl, logger).catch(error => error as AppError);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ statusCode: 400, code: 'bill_image_invalid' });
    expect(String(failure)).not.toMatch(/PRIVATE_|private-image-content|\/private\/path/);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('enforces one overall preparation deadline before starting crops', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(20_000);
    await expect(prepareBillImage(sourceUrl)).rejects.toMatchObject({ code: 'bill_image_prepare_timeout' });
    expect(fake.requests.filter(request => request.region)).toHaveLength(0);
  });
});
