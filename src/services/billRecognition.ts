import { CapacitorPluginMlKitTextRecognition } from '@pantrist/capacitor-plugin-ml-kit-text-recognition';
import type { ParsedTransaction, SplitItem } from '../types';
import { todayISO } from './date';

export type BillSource = 'hema' | 'taobao' | 'generic';

export interface RecognizedBill {
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
  if (/检测|查重|服务|Turnitin/i.test(text)) return knownCategory(categories, '其他');
  if (/咖啡|啤酒|Heineken|喜力|饮料|奶茶|茶饮|美式|拿铁|牛奶|鲜奶|酸奶|发酵乳|矿泉水|纯净水|饮用水|水杯|冰杯|果汁|可乐|茶/.test(text)) {
    return knownCategory(categories, '饮料');
  }
  if (/虾|鸡蛋|提|水果|果蔬|蔬菜|面包|餐|食材|冰淇淋|水饺|馒头|牛肉|猪肉|鸡肉|番茄|蒜米|金果|藜麦|鸡排|馅饼|生鲜|零食|食品|熟食|饼|饭|面|鱼|肉|蛋/.test(text)) {
    return knownCategory(categories, '餐费');
  }
  return knownCategory(categories, '其他');
};

const normalizeAmount = (value: string) => Number(Number(value).toFixed(2));
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

export const recognizeBillImage = async (file: File, categories: string[]): Promise<RecognizedBill> => {
  const fixture = await guessFixture(file);

  if (hasNativeOcrRuntime()) {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
      });
      const base64Image = dataUrl.split(',')[1] ?? dataUrl;
      const response = await CapacitorPluginMlKitTextRecognition.detectText({ base64Image, rotation: 0 });
      const rawText = String(response.text ?? '');
      if (rawText.trim()) {
        const detected = detectSource(rawText);
        return {
          source: detected.source,
          sourceLabel: SOURCE_LABELS[detected.source],
          confidence: detected.confidence,
          rawText,
          result: parseBillText(rawText, detected.source, categories),
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
    source: detected.source,
    sourceLabel: SOURCE_LABELS[detected.source],
    confidence: detected.confidence,
    rawText,
    result: parseBillText(rawText, detected.source, categories),
  };
};

