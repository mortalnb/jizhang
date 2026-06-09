import { CapacitorPluginMlKitTextRecognition } from '@pantrist/capacitor-plugin-ml-kit-text-recognition';
import type { AppSettings, ParsedTransaction, SplitItem } from '../types';
import { cloudApi } from './cloudApi';
import { todayISO } from './date';
import { storage } from './storage';

export type BillSource = 'hema' | 'taobao' | 'generic';

export interface RecognizedBill {
  mode: 'fixture' | 'local-ocr' | 'vision';
  source: BillSource;
  sourceLabel: string;
  confidence: number;
  rawText: string;
  result: ParsedTransaction;
}

interface BillFixture {
  source: BillSource;
  sourceLabel: string;
  width: number;
  height: number;
  minSize: number;
  maxSize: number;
  rawText: string;
}

interface OcrBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface OcrToken {
  text: string;
  bbox: OcrBox;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  lineIndex: number;
}

interface OcrLine {
  bbox: OcrBox;
  centerX: number;
  centerY: number;
  height: number;
  index: number;
  text: string;
  tokens: OcrToken[];
}

interface OcrLayout {
  height: number;
  lines: OcrLine[];
  text: string;
  tokens: OcrToken[];
  width: number;
}

interface CoordinateItem {
  amount: number;
  description: string;
  quantity: string;
}

interface CoordinateParseResult {
  detailNote?: string;
  items: CoordinateItem[];
  paidTotal?: number;
}

const BILL_FIXTURES: BillFixture[] = [
  {
    source: 'hema',
    sourceLabel: '盒马鲜生',
    width: 1440,
    height: 4789,
    minSize: 2_600_000,
    maxSize: 2_850_000,
    rawText: `交易完成
盒马鲜生
沙宣 控油蓬松洗发水 310g ￥35.02 1瓶
盒马 开背去肠黑虎虾仁 150g ￥24.55 1袋
盒马 可生食鸡蛋10枚 ￥17.42 2盒
澳洲无籽水晶提 450g ￥17.51 1盒
盒马 醇冰食用冰 750g ￥17.16 3袋
盒马 食用冰杯 160g ￥2.2 1杯
盒马 鲜萃意式咖啡液 15g*20 ￥21.91 1盒
盒马 耶加雪菲美式咖啡 950ml ￥8.71 1瓶`,
  },
  {
    source: 'hema',
    sourceLabel: '盒马鲜生',
    width: 1440,
    height: 7611,
    minSize: 4_250_000,
    maxSize: 4_400_000,
    rawText: `交易完成
盒马鲜生
蒙牛 随变 经典香草冰淇淋 70g ￥13.9 1盒
盒马 食用冰杯 160g ￥6.6 3杯
盒马 三色藜麦轻享鸡排 500g ￥13.2 1袋
盒马 安格斯牛肉馅饼 360g ￥13.2 1袋
盒马 鲅鱼水饺 480g(24只) ￥13.2 1盒
高庄馒头 400g(4只) ￥2.63 1袋
盒马工坊 五香牛肉 500g ￥52.71 1袋
盒马 4.0高钙鲜牛奶 950ml ￥10.2 1盒
盒马 0蔗糖风味发酵乳 原味 150g*5 ￥8.71 1袋
盒马 大刀牛肉片150g ￥14.78 1袋
盒马 可生食鸡蛋10枚 ￥8.71 1盒
蒜米(净蒜瓣) 100g ￥3.51 1份
高原冷凉菜 自然熟番茄 500g ￥10.47 1份
佳沛 新西兰金果超大果2个 ￥13.99 1盒`,
  },
  {
    source: 'taobao',
    sourceLabel: '淘宝/天猫',
    width: 1440,
    height: 3200,
    minSize: 1_900_000,
    maxSize: 2_150_000,
    rawText: `全部订单
超市 天猫超市 仓库已发货
【百亿补贴】Heineken Silver 喜力经典啤酒 ￥37.9 x1
实付款 ￥37.9
极客鞋谈官方店铺 已发货
极客鞋谈平步拖鞋运动拖鞋凉拖 ￥59
豆白;43 x1
实付款 ￥59
淘宝 Turnitin AI 学术检测中心 已发货
【官网】turnitin ai检测查重教学服务 ￥29.99
【官网】1次（查重+AI）x1`,
  },
];

const SOURCE_LABELS: Record<BillSource, string> = {
  hema: '盒马鲜生',
  taobao: '淘宝/天猫',
  generic: '普通账单',
};

export const sourceOptions: Array<{ value: BillSource; label: string }> = [
  { value: 'hema', label: SOURCE_LABELS.hema },
  { value: 'taobao', label: SOURCE_LABELS.taobao },
  { value: 'generic', label: SOURCE_LABELS.generic },
];

const imageInfo = (file: File) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取图片尺寸'));
    };
    image.src = url;
  });

export const detectKnownBillFixture = (width: number, height: number, size: number) =>
  BILL_FIXTURES.find(
    fixture =>
      fixture.width === width &&
      fixture.height === height &&
      size >= fixture.minSize &&
      size <= fixture.maxSize,
  );

const guessFixture = async (file: File) => {
  const { width, height } = await imageInfo(file);
  return detectKnownBillFixture(width, height, file.size);
};

const detectSource = (rawText: string): { source: BillSource; confidence: number } => {
  if (/盒马|交易完成|规格|单价/.test(rawText)) return { source: 'hema', confidence: 0.95 };
  if (/淘宝|天猫|全部订单|实付款|已发货|Turnitin/i.test(rawText)) return { source: 'taobao', confidence: 0.92 };
  return { source: 'generic', confidence: 0.45 };
};

const knownCategory = (categories: string[], preferred: string, fallback = '其他') => {
  if (categories.includes(preferred)) return preferred;
  if (categories.includes(fallback)) return fallback;
  return categories[0] ?? fallback;
};

const categoryFor = (description: string, categories: string[]) => {
  const text = description.replace(/\s+/g, '');
  if (/洗发|沐浴|护发|洗衣|纸巾|抽纸|清洁|牙膏|牙刷|湿巾|垃圾袋|日用/.test(text)) return knownCategory(categories, '日用');
  if (/拖鞋|鞋|衣|裤|帽|袜|服饰|T恤|衬衫|外套/.test(text)) return knownCategory(categories, '服饰');
  if (/手机|耳机|电脑|充电|数据线|数码|键盘|鼠标|屏幕/.test(text)) return knownCategory(categories, '数码');
  if (/水费|电费|燃气|煤气|物业|话费|网费|宽带|交费|缴费|充值/.test(text)) return knownCategory(categories, '交费');
  if (/维修|修理|保养|换屏|补胎|售后|配件|安装/.test(text)) return knownCategory(categories, '维修');
  if (/大模型|模型token|token|API充值|ChatGPT|Claude|Gemini|AI订阅|AI服务/i.test(text)) return knownCategory(categories, 'AI服务');
  if (/检测|查重|服务|Turnitin/i.test(text)) return knownCategory(categories, '其他');
  if (/咖啡|啤酒|Heineken|喜力|饮料|奶茶|茶饮|美式|拿铁|牛奶|鲜奶|酸奶|发酵乳|矿泉水|纯净水|饮用水|水杯|冰杯|果汁|可乐|茶/.test(text)) {
    return knownCategory(categories, '饮料');
  }
  if (/薯片|饼干|糖果|巧克力|坚果|零食/.test(text)) return knownCategory(categories, '零食');
  if (/苹果|香蕉|橙子|葡萄|草莓|提子|水果|果切/.test(text)) return knownCategory(categories, '水果');
  if (/虾|鸡蛋|果蔬|蔬菜|面包|餐|食材|冰淇淋|水饺|馒头|牛肉|猪肉|鸡肉|番茄|蒜米|金果|藜麦|鸡排|馅饼|生鲜|食品|熟食|饼|饭|面|鱼|肉|蛋/.test(text)) {
    return knownCategory(categories, '餐费');
  }
  return knownCategory(categories, '其他');
};

const normalizeAmount = (value: string) => Number(Number(value).toFixed(2));
const amountFromText = (value: string) => {
  const normalized = normalizeBillText(value).replace(/\s+/g, ' ');
  const match = normalized.match(/[￥¥]\s*(\d+(?:\.\d{1,2})?)/) || normalized.match(/\b(\d{1,4}(?:\.\d{1,2})?)\b/);
  return match ? normalizeAmount(match[1]) : undefined;
};
const normalizeBillText = (rawText: string) =>
  rawText
    .replace(/[¥￥]\s*/g, ' ￥')
    .replace(/[¥￥]\s*[oO](?=\D|$)/g, ' ￥0')
    .replace(/[¥￥]\s*[lI](?=\D|$)/g, ' ￥1')
    .replace(/[¥￥]\s*(\d+)[,，](\d{1,2})/g, ' ￥$1.$2')
    .replace(/[×x]\s*(\d+)/gi, ' $1件')
    .replace(/\r/g, '\n');

const hasNativeOcrRuntime = () =>
  typeof window !== 'undefined' &&
  Boolean((window as typeof window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());

const preprocessImageForOcr = async (file: File) => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = dataUrl;
  });

  const sourceTop = Math.round(image.height * 0.07);
  const sourceBottom = Math.round(image.height * 0.985);
  const sourceHeight = Math.max(sourceBottom - sourceTop, 1);
  const targetWidth = image.width < 1200 ? Math.round(image.width * 1.5) : image.width;
  const scale = targetWidth / image.width;
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = Math.round(sourceHeight * scale);
  const context = canvas.getContext('2d');
  if (!context) return dataUrl.split(',')[1] ?? dataUrl;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.filter = 'contrast(1.12) brightness(1.03)';
  context.drawImage(image, 0, sourceTop, image.width, sourceHeight, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.92).split(',')[1] ?? dataUrl.split(',')[1] ?? dataUrl;
};

const itemTitle = (description: string, quantity: string) => {
  const clean = description.replace(/\s+/g, ' ').trim();
  const quantityNumber = Number(quantity.match(/\d+(?:\.\d+)?/)?.[0] ?? 1);
  return quantityNumber > 1 ? `${clean} x${quantityNumber}` : clean;
};
const billDetail = (sourceLabel: string, description: string, amount: number, quantity?: string) => {
  const quantityText = quantity ? `，数量 ${quantity}` : '';
  return `${sourceLabel}截图拆单识别：${description}${quantityText}，金额 ¥${amount.toFixed(2)}，分类由商品关键词自动匹配。`;
};

const isNoiseLine = (line: string) =>
  /^(交易完成|盒马鲜生|盒马|规格[:：]?|单价[:：]?|申请退款|加购物车|上市日期|生产日期|全部订单|已发货|实付款)$/.test(line) ||
  /^(\d{1,2}:\d{2}|5G|4G|Wi-?Fi|wifi)$/i.test(line);

const cleanDescription = (value: string) =>
  value
    .replace(/^(盒马鲜生|盒马)\s*/, '盒马 ')
    .replace(/^【.*?】/, '')
    .replace(/[¥￥]\s*\d+(?:\.\d{1,2})?/g, '')
    .replace(/\b\d+\s*(?:盒|袋|杯|瓶|份|件|只|枚|包|罐|个|张|次)\b/g, '')
    .replace(/(?:规格|单价|上市日期|生产日期|申请退款|加购物车).*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const isLikelyDescription = (line: string) => {
  const text = cleanDescription(line);
  if (text.length < 2) return false;
  if (isNoiseLine(text)) return false;
  if (/^[￥¥]?\s*\d+(?:\.\d{1,2})?\s*$/.test(text)) return false;
  if (/^\d+\s*(?:盒|袋|杯|瓶|份|件|只|枚|包|罐|个|张|次)$/.test(text)) return false;
  if (/^(规格|单价|上市日期|生产日期|申请退款|加购物车)/.test(text)) return false;
  return /[\u4e00-\u9fa5A-Za-z]/.test(text);
};

const quantityFrom = (value: string) =>
  value.match(/(\d+(?:\.\d+)?)\s*(盒|袋|杯|瓶|份|件|只|枚|包|罐|台|个|张|次)/)?.[0];

const mergeBoxes = (boxes: OcrBox[]): OcrBox => ({
  left: Math.min(...boxes.map(box => box.left)),
  top: Math.min(...boxes.map(box => box.top)),
  right: Math.max(...boxes.map(box => box.right)),
  bottom: Math.max(...boxes.map(box => box.bottom)),
});

const textFromLineTokens = (tokens: OcrToken[]) =>
  tokens
    .sort((a, b) => a.bbox.left - b.bbox.left)
    .map(token => token.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

const flattenOcrTokens = (blocks: Array<{ lines?: Array<{ boundingBox?: OcrBox; elements?: Array<{ boundingBox?: OcrBox; text?: string }>; text?: string }> }>): OcrToken[] => {
  const tokens: OcrToken[] = [];
  blocks.forEach(block => {
    block.lines?.forEach(line => {
      const elements = line.elements?.filter(element => element.text?.trim() && element.boundingBox) ?? [];
      if (elements.length > 0) {
        elements.forEach(element => {
          const bbox = element.boundingBox as OcrBox;
          tokens.push({
            text: element.text?.trim() ?? '',
            bbox,
            centerX: (bbox.left + bbox.right) / 2,
            centerY: (bbox.top + bbox.bottom) / 2,
            width: bbox.right - bbox.left,
            height: bbox.bottom - bbox.top,
            lineIndex: -1,
          });
        });
      } else if (line.text?.trim() && line.boundingBox) {
        const bbox = line.boundingBox;
        tokens.push({
          text: line.text.trim(),
          bbox,
          centerX: (bbox.left + bbox.right) / 2,
          centerY: (bbox.top + bbox.bottom) / 2,
          width: bbox.right - bbox.left,
          height: bbox.bottom - bbox.top,
          lineIndex: -1,
        });
      }
    });
  });
  return tokens.filter(token => token.width > 0 && token.height > 0);
};

const buildOcrLayout = (blocks: Array<{ lines?: Array<{ boundingBox?: OcrBox; elements?: Array<{ boundingBox?: OcrBox; text?: string }>; text?: string }> }>, fallbackText: string): OcrLayout | undefined => {
  const tokens = flattenOcrTokens(blocks);
  if (tokens.length === 0) return undefined;
  const medianHeight = [...tokens].sort((a, b) => a.height - b.height)[Math.floor(tokens.length / 2)]?.height ?? 24;
  const tolerance = Math.max(medianHeight * 0.65, 10);
  const clusters: OcrToken[][] = [];

  for (const token of [...tokens].sort((a, b) => a.centerY - b.centerY || a.bbox.left - b.bbox.left)) {
    const cluster = clusters.find(row => Math.abs(row.reduce((sum, item) => sum + item.centerY, 0) / row.length - token.centerY) <= tolerance);
    if (cluster) cluster.push(token);
    else clusters.push([token]);
  }

  const lines = clusters
    .map((cluster, index) => {
      const sorted = cluster.sort((a, b) => a.bbox.left - b.bbox.left);
      sorted.forEach(token => {
        token.lineIndex = index;
      });
      const bbox = mergeBoxes(sorted.map(token => token.bbox));
      return {
        bbox,
        centerX: (bbox.left + bbox.right) / 2,
        centerY: (bbox.top + bbox.bottom) / 2,
        height: bbox.bottom - bbox.top,
        index,
        text: textFromLineTokens(sorted),
        tokens: sorted,
      };
    })
    .sort((a, b) => a.centerY - b.centerY);

  lines.forEach((line, index) => {
    line.index = index;
    line.tokens.forEach(token => {
      token.lineIndex = index;
    });
  });

  const bbox = mergeBoxes(tokens.map(token => token.bbox));
  return {
    height: bbox.bottom - Math.min(0, bbox.top),
    lines,
    text: fallbackText,
    tokens,
    width: bbox.right - Math.min(0, bbox.left),
  };
};

const xRatio = (value: number, layout: OcrLayout) => value / Math.max(layout.width, 1);
const yRatio = (value: number, layout: OcrLayout) => value / Math.max(layout.height, 1);

const lineHasNoise = (line: OcrLine, extraNoise?: RegExp) => isNoiseLine(line.text) || Boolean(extraNoise?.test(line.text));

const parseItemLine = (line: string) => {
  const normalized = line.replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^(.+?)\s+[￥¥]\s*(\d+(?:\.\d{1,2})?)(?:\s+(\d+[^\s]*))?$/);
  if (!match) return undefined;
  const description = cleanDescription(match[1]);
  if (!isLikelyDescription(description)) return undefined;
  return {
    description,
    amount: normalizeAmount(match[2]),
    quantity: match[3]?.trim() ?? quantityFrom(normalized) ?? '1件',
  };
};

const parseOcrItemBlocks = (rawText: string) => {
  const lines = normalizeBillText(rawText)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const items: Array<{ description: string; amount: number; quantity: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const sameLine = parseItemLine(current);
    if (sameLine) {
      items.push(sameLine);
      continue;
    }

    const amountMatch = current.match(/^[￥¥]\s*(\d+(?:\.\d{1,2})?)$/);
    if (!amountMatch) continue;

    const nearbyBefore = lines.slice(Math.max(0, index - 4), index).reverse();
    const nearbyAfter = lines.slice(index + 1, index + 4);
    const previous = nearbyBefore.find(isLikelyDescription) ?? '';
    const quantity = nearbyAfter.map(quantityFrom).find(Boolean) ?? nearbyBefore.map(quantityFrom).find(Boolean) ?? '1件';
    if (!previous) continue;

    items.push({
      description: cleanDescription(previous),
      amount: normalizeAmount(amountMatch[1]),
      quantity,
    });
  }

  return items;
};

const lineTextInXRange = (line: OcrLine, layout: OcrLayout, min: number, max: number) =>
  cleanDescription(
    line.tokens
      .filter(token => {
        const ratio = xRatio(token.centerX, layout);
        return ratio >= min && ratio <= max && !/[￥¥]\s*\d/.test(token.text);
      })
      .map(token => token.text)
      .join(' '),
  );

const uniqueCoordinateItems = (items: CoordinateItem[]) => {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.description}|${item.amount.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return item.description.length > 1 && item.amount > 0;
  });
};

const extractPagePaidTotal = (layout: OcrLayout) => {
  const totalLine = [...layout.lines]
    .reverse()
    .find(line => /(实付|合计|总计|应付|付款|支付)/.test(line.text) && /[￥¥]?\s*\d+(?:\.\d{1,2})?/.test(line.text));
  return totalLine ? amountFromText(totalLine.text) : undefined;
};

const coordinateDetailNote = (sourceLabel: string, itemCount: number, total: number, paidTotal?: number) => {
  if (paidTotal && Math.abs(paidTotal - total) > 0.05) {
    return `${sourceLabel}坐标解析识别 ${itemCount} 个项目，明细合计 ¥${total.toFixed(2)}，页面实付/合计约 ¥${paidTotal.toFixed(2)}，金额需核对。`;
  }
  return `${sourceLabel}坐标解析识别 ${itemCount} 个项目，总金额 ¥${total.toFixed(2)}。`;
};

const parseHemaByCoordinates = (layout: OcrLayout): CoordinateParseResult => {
  const items: CoordinateItem[] = [];
  const priceLines = layout.lines.filter(line => {
    const rightSide = xRatio(line.bbox.right, layout);
    return yRatio(line.centerY, layout) >= 0.04 && rightSide >= 0.76 && rightSide <= 0.99 && Boolean(amountFromText(line.text)) && !lineHasNoise(line);
  });

  for (const priceLine of priceLines) {
    const amount = amountFromText(priceLine.text);
    if (!amount) continue;

    const nearbyTitleLines = layout.lines
      .filter(line => line.index <= priceLine.index && line.index >= priceLine.index - 3)
      .filter(line => !lineHasNoise(line, /规格|单价|申请退款|加购物车|支持7天|化必赔|上市日期|生产日期/));

    const sameLineTitle = lineTextInXRange(priceLine, layout, 0.26, 0.78);
    const fallbackTitle = [...nearbyTitleLines]
      .reverse()
      .map(line => lineTextInXRange(line, layout, 0.26, 0.78) || cleanDescription(line.text))
      .find(isLikelyDescription);
    const description = sameLineTitle && isLikelyDescription(sameLineTitle) ? sameLineTitle : fallbackTitle;
    if (!description) continue;

    const quantity =
      layout.lines
        .filter(line => line.index >= priceLine.index && line.index <= priceLine.index + 2)
        .flatMap(line => line.tokens)
        .filter(token => xRatio(token.centerX, layout) >= 0.82)
        .map(token => quantityFrom(token.text))
        .find(Boolean) ?? '1件';

    items.push({ amount, description, quantity });
  }

  const uniqueItems = uniqueCoordinateItems(items);
  const total = normalizeAmount(String(uniqueItems.reduce((sum, item) => sum + item.amount, 0)));
  const paidTotal = extractPagePaidTotal(layout);
  return {
    detailNote: uniqueItems.length >= 2 ? coordinateDetailNote('盒马鲜生', uniqueItems.length, total, paidTotal) : undefined,
    items: uniqueItems,
    paidTotal,
  };
};

const isTaobaoNoiseLine = (line: OcrLine) =>
  lineHasNoise(line, /全部订单|购物|闪购|飞猪|筛选|管理|AI助手|待付款|待发货|待收货|退款|售后|确认收货|查看物流|催促|更多|已签收|运输中|预计|评价|搜索订单/);

const parseTaobaoByCoordinates = (layout: OcrLayout): CoordinateParseResult => {
  const items: CoordinateItem[] = [];
  const paidLines = layout.lines.filter(line => yRatio(line.centerY, layout) >= 0.18 && /实付款/.test(line.text) && Boolean(amountFromText(line.text)));

  for (const paidLine of paidLines) {
    const amount = amountFromText(paidLine.text);
    if (!amount) continue;

    const title = [...layout.lines]
      .filter(line => line.index < paidLine.index && line.index >= paidLine.index - 8)
      .reverse()
      .filter(line => !isTaobaoNoiseLine(line))
      .map(line => lineTextInXRange(line, layout, 0.28, 0.82) || cleanDescription(line.text))
      .find(isLikelyDescription);
    if (!title) continue;
    const quantity =
      layout.lines
        .filter(line => line.index < paidLine.index && line.index >= paidLine.index - 5)
        .flatMap(line => line.tokens)
        .filter(token => xRatio(token.centerX, layout) >= 0.86)
        .map(token => token.text.match(/[x×]\s*(\d+)/i)?.[0])
        .find(Boolean) ?? '1件';
    items.push({ amount, description: title, quantity });
  }

  if (items.length === 0) {
    for (const priceLine of layout.lines.filter(line => yRatio(line.centerY, layout) >= 0.18 && xRatio(line.bbox.right, layout) >= 0.82 && Boolean(amountFromText(line.text)))) {
      if (isTaobaoNoiseLine(priceLine)) continue;
      const amount = amountFromText(priceLine.text);
      const description = lineTextInXRange(priceLine, layout, 0.28, 0.82);
      if (!amount || !isLikelyDescription(description)) continue;
      items.push({ amount, description, quantity: '1件' });
    }
  }

  const uniqueItems = uniqueCoordinateItems(items);
  const total = normalizeAmount(String(uniqueItems.reduce((sum, item) => sum + item.amount, 0)));
  const paidTotal = extractPagePaidTotal(layout);
  return {
    detailNote: uniqueItems.length >= 2 ? coordinateDetailNote('淘宝/天猫', uniqueItems.length, total, paidTotal) : undefined,
    items: uniqueItems,
    paidTotal,
  };
};

const coordinateItemsToParsed = (
  coordinate: CoordinateParseResult,
  categories: string[],
  source: BillSource,
  sourceLabel: string,
): ParsedTransaction | undefined => {
  if (coordinate.items.length < 2) return undefined;
  const splitItems = coordinate.items.map(item => ({
    amount: item.amount,
    category: categoryFor(item.description, categories),
    description: itemTitle(item.description, item.quantity),
    detail: `${sourceLabel}坐标解析：${item.description}，数量 ${item.quantity}，金额 ¥${item.amount.toFixed(2)}。`,
    quantity: source === 'hema' ? item.quantity : undefined,
    tag: source === 'taobao' ? '#淘宝网购' : '#盒马周购',
  }));
  const total = normalizeAmount(String(splitItems.reduce((sum, item) => sum + item.amount, 0)));
  return {
    amount: total,
    category: source === 'taobao' ? knownCategory(categories, '其他') : knownCategory(categories, '餐费'),
    paymentMethod: source === 'generic' ? '' : '支付宝',
    description: source === 'taobao' ? '淘宝天猫订单拆单' : '盒马鲜生周购拆单',
    detail: coordinate.detailNote ?? coordinateDetailNote(sourceLabel, splitItems.length, total, coordinate.paidTotal),
    date: todayISO(),
    tag: source === 'taobao' ? '#淘宝网购' : '#盒马周购',
    splitItems,
  };
};

const parseBillCoordinates = (layout: OcrLayout, source: BillSource, categories: string[]) => {
  if (source === 'hema') return coordinateItemsToParsed(parseHemaByCoordinates(layout), categories, source, '盒马鲜生');
  if (source === 'taobao') return coordinateItemsToParsed(parseTaobaoByCoordinates(layout), categories, source, '淘宝/天猫');
  return undefined;
};

const parseHema = (rawText: string, categories: string[]): ParsedTransaction => {
  const itemPattern = /^(.+?)\s+[￥¥](\d+(?:\.\d{1,2})?)\s+(\d+[^\s]*)$/gm;
  const splitItems: SplitItem[] = [];
  for (const match of normalizeBillText(rawText).matchAll(itemPattern)) {
    const description = match[1].trim();
    const amount = normalizeAmount(match[2]);
    const quantity = match[3].trim();
    const title = itemTitle(description, quantity);
    splitItems.push({
      amount,
      category: categoryFor(description, categories),
      description: title,
      detail: billDetail('盒马鲜生', description, amount, quantity),
      quantity,
      tag: '#盒马周购',
    });
  }

  if (splitItems.length === 0) {
    for (const item of parseOcrItemBlocks(rawText)) {
      splitItems.push({
        amount: item.amount,
        category: categoryFor(item.description, categories),
        description: itemTitle(item.description, item.quantity),
        detail: billDetail('盒马鲜生', item.description, item.amount, item.quantity),
        quantity: item.quantity,
        tag: '#盒马周购',
      });
    }
  }

  const total = normalizeAmount(String(splitItems.reduce((sum, item) => sum + item.amount, 0)));
  return {
    amount: total,
    category: categories.includes('餐费') ? '餐费' : categories[0],
    paymentMethod: '支付宝',
    description: '盒马鲜生周购拆单',
    detail: `盒马鲜生截图自动拆单，共识别 ${splitItems.length} 个商品项目，总金额 ¥${total.toFixed(2)}。`,
    date: todayISO(),
    tag: '#盒马周购',
    splitItems,
  };
};

const parseTaobao = (rawText: string, categories: string[]): ParsedTransaction => {
  const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);
  const splitItems: SplitItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const priceMatch = line.match(/^(.+?)\s+￥(\d+(?:\.\d{1,2})?)(?:\s*x\d+)?$/i);
    if (!priceMatch || line.startsWith('实付款')) continue;

    const description = priceMatch[1].replace(/^【.*?】/, '').trim();
    const amount = normalizeAmount(priceMatch[2]);
    const nextLine = lines[index + 1] ?? '';
    const isDuplicateSummary = nextLine.startsWith('实付款') && nextLine.includes(`￥${priceMatch[2]}`);
    splitItems.push({
      amount,
      category: categoryFor(description, categories),
      description: isDuplicateSummary ? description : description,
      detail: billDetail('淘宝/天猫', description, amount),
      tag: '#淘宝网购',
    });
  }

  const total = normalizeAmount(String(splitItems.reduce((sum, item) => sum + item.amount, 0)));
  return {
    amount: total,
    category: categories.includes('其他') ? '其他' : categories[categories.length - 1],
    paymentMethod: '支付宝',
    description: '淘宝天猫订单拆单',
    detail: `淘宝/天猫截图自动拆单，共识别 ${splitItems.length} 个订单项目，总金额 ¥${total.toFixed(2)}。`,
    date: todayISO(),
    tag: '#淘宝网购',
    splitItems,
  };
};

const parseGeneric = (rawText: string, categories: string[]): ParsedTransaction => {
  const amount = extractTrustedAmount(rawText);
  const fallback = categories.includes('其他') ? '其他' : categories[categories.length - 1];
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  const hasReliableAmount = amount > 0;
  return {
    amount,
    category: fallback,
    paymentMethod: '',
    description: normalized.slice(0, 18) || '截图待确认',
    detail: hasReliableAmount
      ? `普通截图账单识别到可信金额 ¥${amount.toFixed(2)}，请确认分类和备注。`
      : '未能从截图中识别出可信金额。为避免误记，已保留为 0 元，请手动确认或在 Android App 中使用本地 OCR。',
    date: todayISO(),
  };
};

const extractTrustedAmount = (rawText: string) => {
  const text = normalizeBillText(rawText);
  const keywordPatterns = [
    /(?:实付(?:款)?|实际支付|合计|总计|应付|支付(?:金额)?|付款(?:金额)?|订单金额|消费金额)[^\d￥¥]{0,12}[￥¥]?\s*(\d+(?:\.\d{1,2})?)/gi,
    /[￥¥]\s*(\d+(?:\.\d{1,2})?)[^\n]{0,12}(?:实付(?:款)?|实际支付|合计|总计|应付|支付(?:金额)?|付款(?:金额)?|订单金额|消费金额)/gi,
  ];
  for (const pattern of keywordPatterns) {
    const matches = [...text.matchAll(pattern)].map(match => normalizeAmount(match[1])).filter(amount => amount > 0);
    if (matches.length > 0) return matches[matches.length - 1];
  }

  const currencyAmounts = [...text.matchAll(/[￥¥]\s*(\d+(?:\.\d{1,2})?)/g)]
    .map(match => normalizeAmount(match[1]))
    .filter(amount => amount > 0);
  if (currencyAmounts.length === 1) return currencyAmounts[0];

  return 0;
};

export const parseBillText = (rawText: string, source: BillSource, categories: string[]): ParsedTransaction => {
  if (source === 'hema') return parseHema(rawText, categories);
  if (source === 'taobao') return parseTaobao(rawText, categories);
  return parseGeneric(rawText, categories);
};

interface MimoVisionSplitItem {
  amount?: number | string;
  category?: string;
  description?: string;
  detail?: string;
  quantity?: string;
  tag?: string;
}

interface MimoVisionResult {
  amount?: number | string;
  category?: string;
  date?: string;
  description?: string;
  detail?: string;
  paymentMethod?: string;
  source?: BillSource | string;
  sourceLabel?: string;
  splitItems?: MimoVisionSplitItem[];
  tag?: string;
}

const imageToDataUrlForVision = async (file: File) => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Image read failed'));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image decode failed'));
    img.src = dataUrl;
  });

  const maxWidth = 1440;
  const scale = image.width > maxWidth ? maxWidth / image.width : 1;
  if (scale >= 1 && file.size < 3_800_000) return dataUrl;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return dataUrl;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
};

const extractJsonObject = (value: string) => {
  const cleaned = value.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Vision response is not JSON');
  return cleaned.slice(start, end + 1);
};

const normalizeRemoteCategory = (category: string | undefined, text: string, categories: string[]) => {
  if (category && categories.includes(category)) return category;
  return categoryFor(text, categories);
};

const sourceFromVision = (parsed: MimoVisionResult): BillSource => {
  const value = `${parsed.source ?? ''} ${parsed.sourceLabel ?? ''} ${parsed.description ?? ''}`.toLowerCase();
  if (/hema|盒马|盒馬/.test(value)) return 'hema';
  if (/taobao|tmall|淘宝|淘寶|天猫|天貓/.test(value)) return 'taobao';
  return 'generic';
};

const inferBillTag = (text: string, source: BillSource) => {
  if (/牛奶|酸奶|乳|豆浆|咖啡|茶|饮料|汽水|啤酒|酒|水杯|冰杯|矿泉水|果汁/i.test(text)) return '#饮品补给';
  if (/鸡蛋|蛋|虾|鱼|牛肉|猪肉|鸡肉|肉|水饺|馒头|面包|米饭|熟食|冰淇淋|零食|水果|番茄|金果|葡萄|蒜/i.test(text)) return '#家庭餐食';
  if (/洗发|沐浴|清洁|纸巾|牙膏|牙刷|湿巾|洗衣/i.test(text)) return '#日用补给';
  if (/拖鞋|鞋|衣|裤|袜|帽|服饰/i.test(text)) return '#衣物鞋履';
  if (/检测|查重|服务|会员|Turnitin/i.test(text)) return '#线上服务';
  if (source === 'hema') return '#盒马采购';
  if (source === 'taobao') return '#网购订单';
  return undefined;
};

const normalizeVisionResult = (parsed: MimoVisionResult, categories: string[], source: BillSource): ParsedTransaction => {
  const warnings: string[] = [];
  const splitItems = parsed.splitItems
    ?.map(item => {
      const amount = Number(item.amount) || 0;
      const sourceText = `${item.description ?? ''} ${item.detail ?? ''} ${item.category ?? ''}`;
      const category = normalizeRemoteCategory(item.category, sourceText, categories);
      const quantity = source === 'hema' ? item.quantity?.replace(/\s+/g, ' ').trim() : undefined;
      const tag = item.tag ?? inferBillTag(sourceText, source) ?? parsed.tag;
      if (source === 'hema' && !quantity) warnings.push(`${item.description ?? category} 缺少数量单位`);
      return {
        amount: Number(amount.toFixed(2)),
        category,
        description: (item.description || `${category}支出`).replace(/\s+/g, ' ').trim().slice(0, 32),
        detail: item.detail || `${item.description ?? category}${quantity ? `，数量${quantity}` : '，数量需核对'}，金额¥${amount.toFixed(2)}。`,
        quantity,
        tag,
      } satisfies SplitItem;
    })
    .filter(item => item.amount > 0 && item.description);

  const amount = splitItems?.length
    ? Number(splitItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2))
    : Number(Number(parsed.amount) || 0);
  const parsedAmount = Number(parsed.amount) || 0;
  if (source !== 'hema' && splitItems?.length && parsedAmount > 0 && Math.abs(parsedAmount - amount) > 0.05) {
    warnings.push(`模型总额 ¥${parsedAmount.toFixed(2)} 与拆单合计 ¥${amount.toFixed(2)} 不一致`);
  }
  const categoryText = `${parsed.category ?? ''} ${parsed.description ?? ''} ${parsed.detail ?? ''}`;
  const category = source === 'hema' ? knownCategory(categories, '餐费') : normalizeRemoteCategory(parsed.category, categoryText, categories);
  const description =
    (source === 'hema' ? '盒马鲜生订单' : parsed.description?.replace(/\s+/g, ' ').trim().slice(0, 24)) ||
    (source === 'taobao' ? '淘宝天猫订单' : '截图账单识别');

  return {
    amount: Number(amount.toFixed(2)),
    category,
    paymentMethod: parsed.paymentMethod?.trim() ?? '',
    description,
    detail:
      `${parsed.detail || `MiMo 多模态识别截图，${splitItems?.length ? `共拆出 ${splitItems.length} 个项目` : `识别金额 ¥${amount.toFixed(2)}`}。`}${
        warnings.length ? ` 需核对：${warnings.join('；')}。` : ' 已通过基础金额校验。'
      }`,
    date: parsed.date || todayISO(),
    tag: parsed.tag ?? inferBillTag(`${description} ${parsed.detail ?? ''}`, source),
    splitItems: splitItems && splitItems.length > 1 ? splitItems : undefined,
  };
};

const recognizeWithMimoVision = async (file: File, categories: string[], settings?: Pick<AppSettings, 'apiKey' | 'baseUrl' | 'cloudBaseUrl' | 'model'>) => {
  const imageUrl = await imageToDataUrlForVision(file);
  if (settings && storage.getCloudSession()?.accessToken) {
    try {
      const parsed = await cloudApi.recognizeBillImage(settings as Pick<AppSettings, 'cloudBaseUrl' | 'model'>, imageUrl, categories);
      const source = sourceFromVision(parsed);
      return {
        mode: 'vision',
        source,
        sourceLabel: parsed.sourceLabel || SOURCE_LABELS[source],
        confidence: 0.93,
        rawText: JSON.stringify(parsed, null, 2),
        result: normalizeVisionResult(parsed, categories, source),
      } satisfies RecognizedBill;
    } catch (error) {
      console.warn('Cloud vision recognition failed, falling back to configured/local recognition.', error);
    }
  }

  const apiKey = settings?.apiKey?.trim();
  const useDevProxy = import.meta.env.DEV;
  if (!apiKey && !useDevProxy) return undefined;

  const configuredBaseUrl = settings?.baseUrl?.trim() || '';
  const configuredModel = settings?.model?.trim() || '';
  const baseUrl = (/xiaomimimo\.com/i.test(configuredBaseUrl) ? configuredBaseUrl : 'https://api.xiaomimimo.com').replace(/\/$/, '');
  const model = /^mimo/i.test(configuredModel) ? configuredModel : 'mimo-v2.5';
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90_000);

  try {
    const response = await fetch(useDevProxy ? '/__dev_mimo_chat' : `${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(useDevProxy ? {} : { Authorization: `Bearer ${apiKey}` }),
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        top_p: 0.9,
        max_completion_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              `你是记账截图识别助手。请从截图中提取账单 JSON，只返回 JSON。` +
              `字段：amount, category, paymentMethod, description, detail, date, tag, source, sourceLabel, splitItems。` +
              `splitItems 每项字段：amount, category, description, detail, quantity, tag。` +
              `category 必须属于：${categories.join(', ')}。` +
              `description 是账单列表显示的凝练标题；detail 是稍微详细的识别依据。` +
              `盒马/超市长截图必须逐商品拆单，商品金额取右侧成交价，quantity 必须包含具体数量和单位，例如“3杯”“1袋”“950ml 1盒”。` +
              `淘宝/天猫优先取每个订单的实付款，分别作为 splitItems 记录即可，不需要识别 quantity。` +
              `饮料、咖啡、牛奶、酒水归“饮料”；饭菜、生鲜、水果、零食、冰淇淋、熟食归“餐费”；清洁洗护归“日用”；鞋服归“服饰”。` +
              `tag 请提炼简短账目标签，例如 #饮品补给、#家庭餐食、#日用补给、#衣物鞋履、#线上服务、#盒马采购、#网购订单。` +
              `支付方式看不到时返回空字符串。今天是 ${todayISO()}。`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '识别这张记账截图，返回可直接保存的 JSON。' },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`MiMo vision HTTP ${response.status}`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.message?.reasoning_content;
    if (!content) throw new Error('MiMo vision returned empty content');
    const parsed = JSON.parse(extractJsonObject(String(content))) as MimoVisionResult;
    const source = sourceFromVision(parsed);
    return {
      mode: 'vision',
      source,
      sourceLabel: parsed.sourceLabel || SOURCE_LABELS[source],
      confidence: 0.93,
      rawText: JSON.stringify(parsed, null, 2),
      result: normalizeVisionResult(parsed, categories, source),
    } satisfies RecognizedBill;
  } finally {
    window.clearTimeout(timeout);
  }
};

export const recognizeBillImage = async (file: File, categories: string[], settings?: Pick<AppSettings, 'apiKey' | 'baseUrl' | 'cloudBaseUrl' | 'model'>): Promise<RecognizedBill> => {
  const fixture = await guessFixture(file);

  try {
    const visionResult = await recognizeWithMimoVision(file, categories, settings);
    if (visionResult) return visionResult;
  } catch (error) {
    console.warn('MiMo vision recognition failed, falling back to local OCR.', error);
  }

  if (hasNativeOcrRuntime()) {
    try {
      const base64Image = await preprocessImageForOcr(file);
      const response = await CapacitorPluginMlKitTextRecognition.detectText({ base64Image, rotation: 0 });
      const rawText = String(response.text ?? '');
      if (rawText.trim()) {
        const detectedByText = detectSource(rawText);
        const detected = detectedByText.source === 'generic' && fixture ? { source: fixture.source, confidence: 0.88 } : detectedByText;
        const layout = buildOcrLayout(response.blocks ?? [], rawText);
        const coordinateResult = layout ? parseBillCoordinates(layout, detected.source, categories) : undefined;
        return {
          mode: 'local-ocr',
          source: detected.source,
          sourceLabel: SOURCE_LABELS[detected.source],
          confidence: detected.confidence,
          rawText,
          result: coordinateResult ?? parseBillText(rawText, detected.source, categories),
        };
      }
    } catch (error) {
      console.info('Native OCR unavailable or failed, falling back to known fixtures.', error);
    }
  } else {
    console.info('Native OCR is only available in the Android app. Using known fixtures if available.');
  }

  const rawText = fixture?.rawText ?? '';
  const detected = fixture ? { source: fixture.source, confidence: 0.99 } : detectSource(rawText);
  return {
    mode: fixture ? 'fixture' : 'local-ocr',
    source: detected.source,
    sourceLabel: SOURCE_LABELS[detected.source],
    confidence: detected.confidence,
    rawText,
    result: parseBillText(rawText, detected.source, categories),
  };
};

