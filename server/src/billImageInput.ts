import type { FastifyBaseLogger } from 'fastify';
import sharp from 'sharp';
import { AppError } from './errors.js';

const MAX_INPUT_CHARACTERS = 7_000_000;
const MAX_INPUT_PIXELS = 16_000_000;
const MAX_SIDE = 8192;
const MAX_TILE_HEIGHT = 4096;
const TILE_OVERLAP = 192;
const MAX_TILES = 6;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const PREPARE_TIMEOUT_MS = 20_000;

// Keep native memory and worker use bounded independently of the model timeout.
sharp.cache(false);
sharp.concurrency(1);

export type BillImageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface BillImageTile {
  left: number;
  top: number;
  width: number;
  height: number;
}

const invalidImage = () => new AppError(400, 'bill_image_invalid', '无法读取或处理图片，请重新导出为 JPG、PNG、WebP 或静态 GIF 后再试。');
const tooManyPixels = () => new AppError(400, 'bill_image_too_large', '图片像素超过处理上限，请按账单边界分开导入。');

const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Coordinates refer to the displayed image after EXIF orientation is applied. */
export const planBillImageTiles = (width: number, height: number): BillImageTile[] => {
  if (!positiveInteger(width) || !positiveInteger(height)) throw invalidImage();
  if (width > MAX_SIDE) {
    throw new AppError(400, 'bill_image_too_wide', '图片显示宽度超过 8192 像素，请按账单边界分开导入。');
  }
  if (width * height > MAX_INPUT_PIXELS) throw tooManyPixels();
  if (height <= MAX_SIDE) return [{ left: 0, top: 0, width, height }];

  const count = Math.ceil((height - TILE_OVERLAP) / (MAX_TILE_HEIGHT - TILE_OVERLAP));
  if (count > MAX_TILES) {
    throw new AppError(400, 'bill_image_too_long', '长截图超过处理上限，请按账单边界分开导入。');
  }
  const balancedHeight = Math.ceil((height + (count - 1) * TILE_OVERLAP) / count);
  return Array.from({ length: count }, (_, index) => {
    const top = index * (balancedHeight - TILE_OVERLAP);
    return { left: 0, top, width, height: Math.min(balancedHeight, height - top) };
  });
};

const readDataUrl = (imageDataUrl: string) => {
  if (typeof imageDataUrl !== 'string' || imageDataUrl.length > MAX_INPUT_CHARACTERS) {
    throw new AppError(400, 'bill_image_input_too_large', '图片数据超过上传上限，请按账单边界分开导入。');
  }
  const match = /^data:image\/(jpeg|jpg|png|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(imageDataUrl);
  if (!match || match[2].length % 4 !== 0) throw invalidImage();
  const bytes = Buffer.from(match[2], 'base64');
  // Buffer's permissive decoder otherwise accepts malformed padding and tail bits.
  if (!bytes.length || bytes.toString('base64') !== match[2]) throw invalidImage();
  const declaredFormat = match[1].toLowerCase().replace(/^jpg$/, 'jpeg');
  return { bytes, declaredFormat };
};

export const prepareBillImage = async (
  imageDataUrl: string,
  logger?: Pick<FastifyBaseLogger, 'info'>,
): Promise<BillImageContentPart[]> => {
  const startedAt = Date.now();
  const secondsRemaining = () => {
    const remaining = PREPARE_TIMEOUT_MS - (Date.now() - startedAt);
    if (remaining <= 0) throw new AppError(400, 'bill_image_prepare_timeout', '图片处理超时，请按账单边界分开导入。');
    return Math.max(1, Math.ceil(remaining / 1000));
  };
  const { bytes, declaredFormat } = readDataUrl(imageDataUrl);
  const decoderOptions = { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'warning' as const, sequentialRead: true };

  try {
    const metadata = await sharp(bytes, decoderOptions).timeout({ seconds: secondsRemaining() }).metadata();
    const format = metadata.format;
    if (!format || !['jpeg', 'png', 'webp', 'gif'].includes(format) || format !== declaredFormat) throw invalidImage();
    if (!positiveInteger(metadata.width) || !positiveInteger(metadata.height)) throw invalidImage();
    if (!positiveInteger(metadata.channels) || metadata.channels > 4) throw invalidImage();
    if (metadata.pages !== undefined && metadata.pages !== 1) {
      throw new AppError(400, 'bill_image_animated', '暂不支持多帧图片，请导出一张静态截图后再试。');
    }
    const orientation = metadata.orientation ?? 1;
    if (!positiveInteger(orientation) || orientation > 8) throw invalidImage();
    const sideways = orientation >= 5;
    const width = sideways ? metadata.height : metadata.width;
    const height = sideways ? metadata.width : metadata.height;
    const tiles = planBillImageTiles(width, height);
    secondsRemaining();

    if (tiles.length === 1) {
      logger?.info({
        event: 'bill_image_prepared', format, width, height, pixels: width * height,
        inputBytes: bytes.length, tileCount: 1, outputBytes: bytes.length, prepMs: Date.now() - startedAt,
      }, 'Bill image input prepared');
      return [{ type: 'image_url', image_url: { url: imageDataUrl } }];
    }

    const content: BillImageContentPart[] = [{
      type: 'text',
      text: `以下 ${tiles.length} 个片段连续来自同一张长截图，请按片序合看，片段数量不代表账单数量。相邻片段重叠 ${TILE_OVERLAP} 行；同一源位置的重叠商品或金额只记录一次，不同位置出现的同名商品不能因此合并。仍须按真实订单、日期和独立付款边界决定顶层交易数量，同一次结账的商品放入同一笔的 splitItems。`,
    }];
    let outputBytes = 0;
    for (const [index, tile] of tiles.entries()) {
      // Serial lossless crops retain the displayed text pixels without resizing.
      const png = await sharp(bytes, decoderOptions)
        .autoOrient()
        .extract(tile)
        .png()
        .timeout({ seconds: secondsRemaining() })
        .toBuffer();
      outputBytes += png.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        throw new AppError(400, 'bill_image_output_too_large', '长截图分片数据超过处理上限，请按账单边界分开导入。');
      }
      secondsRemaining();
      content.push(
        { type: 'text', text: `同一原截图第 ${index + 1}/${tiles.length} 片：显示坐标 y=${tile.top} 至 ${tile.top + tile.height - 1}（从 0 开始，按此顺序合看）。` },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
      );
    }
    logger?.info({
      event: 'bill_image_prepared', format, width, height, pixels: width * height,
      inputBytes: bytes.length, tileCount: tiles.length, outputBytes, prepMs: Date.now() - startedAt,
    }, 'Bill image input prepared');
    return content;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (Date.now() - startedAt >= PREPARE_TIMEOUT_MS) {
      throw new AppError(400, 'bill_image_prepare_timeout', '图片处理超时，请按账单边界分开导入。');
    }
    throw invalidImage();
  }
};
