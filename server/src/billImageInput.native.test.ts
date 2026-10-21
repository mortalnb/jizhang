import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { planBillImageTiles, prepareBillImage } from './billImageInput.js';

const patternedPixels = (width: number, height: number) => {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      // Row and column coordinates produce different pixels across crop edges.
      pixels[offset] = (y + x * 11) % 251;
      pixels[offset + 1] = (Math.floor(y / 251) + x * 7) % 253;
      pixels[offset + 2] = (x + Math.floor(x / 251) * 17 + y * 13) % 256;
    }
  }
  return pixels;
};

const expectLosslessCrops = async (source: Buffer, mime: 'png' | 'jpeg', width: number, height: number) => {
  const url = `data:image/${mime};base64,${source.toString('base64')}`;
  const displayed = await sharp(source).autoOrient().raw().toBuffer({ resolveWithObject: true });
  expect(displayed.info).toMatchObject({ width, height, channels: 3 });
  const parts = await prepareBillImage(url);
  const images = parts.filter(part => part.type === 'image_url');
  const layout = planBillImageTiles(width, height);
  expect(images).toHaveLength(3);
  expect(layout).toHaveLength(3);

  for (const [index, part] of images.entries()) {
    expect(part.image_url.url).toMatch(/^data:image\/png;base64,/);
    const encoded = Buffer.from(part.image_url.url.split(',')[1], 'base64');
    const tile = layout[index];
    expect(await sharp(encoded).metadata()).toMatchObject({ format: 'png', width: tile.width, height: tile.height });
    const decoded = await sharp(encoded).raw().toBuffer({ resolveWithObject: true });
    expect(decoded.info).toMatchObject({ width: tile.width, height: tile.height, channels: 3 });
    const rowBytes = width * 3;
    const expectedPixels = displayed.data.subarray(tile.top * rowBytes, (tile.top + tile.height) * rowBytes);
    // This compares decoded source rows, including both overlap regions, exactly.
    expect(decoded.data.equals(expectedPixels)).toBe(true);
  }
};

describe('bill-image preparation with the actual native Sharp runtime', () => {
  it('preserves all displayed pixels and row positions in three lossless PNG crops', async () => {
    const width = 64;
    const height = 8300;
    const pixels = patternedPixels(width, height);
    const source = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const decodedSource = await sharp(source).raw().toBuffer();
    expect(decodedSource.equals(pixels)).toBe(true);
    await expectLosslessCrops(source, 'png', width, height);
  });

  it('keeps an ordinary PNG URL byte-for-byte unchanged', async () => {
    const width = 64;
    const height = 120;
    const source = await sharp(patternedPixels(width, height), { raw: { width, height, channels: 3 } }).png().toBuffer();
    const url = `data:image/png;base64,${source.toString('base64')}`;
    expect(await prepareBillImage(url)).toEqual([{ type: 'image_url', image_url: { url } }]);
  });

  it('applies EXIF orientation 6 before extracting displayed long-image rows', async () => {
    const width = 8300;
    const height = 64;
    const source = await sharp(patternedPixels(width, height), { raw: { width, height, channels: 3 } })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
      .toBuffer();
    expect(await sharp(source).metadata()).toMatchObject({ width, height, orientation: 6 });
    // JPEG encoding is lossy; compare crops against the decoded, oriented JPEG.
    await expectLosslessCrops(source, 'jpeg', height, width);
  });
});
