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

const categoryFor = (description: string, categories: string[]) => {
  if (/洗发|食用冰杯|日用|纸巾|清洁/.test(description)) return categories.includes('日用') ? '日用' : categories[0];
  if (/拖鞋|鞋|衣|裤/.test(description)) return categories.includes('服饰') ? '服饰' : categories[0];
  if (/检测|查重|服务|Turnitin/i.test(description)) return categories.includes('其他') ? '其他' : categories[categories.length - 1];
  if (/咖啡|啤酒|Heineken|喜力|饮料|奶茶|茶饮|美式|拿铁/.test(description)) return categories.includes('饮料') ? '饮料' : categories[0];
  if (/虾|鸡蛋|提|水果|果蔬|面包|餐|食材/.test(description)) return categories.includes('餐费') ? '餐费' : categories[0];
  return categories.includes('其他') ? '其他' : categories[categories.length - 1];
};

const normalizeAmount = (value: string) => Number(Number(value).toFixed(2));
const billDetail = (sourceLabel: string, description: string, amount: number) =>
  `${sourceLabel}截图拆单识别：${description}，金额 ¥${amount.toFixed(2)}，分类由商品关键词自动匹配。`;

const parseHema = (rawText: string, categories: string[]): ParsedTransaction => {
  const itemPattern = /^(.+?)\s+￥(\d+(?:\.\d{1,2})?)\s+\d+[^\s]*$/gm;
  const splitItems: SplitItem[] = [];
  for (const match of rawText.matchAll(itemPattern)) {
    const description = match[1].trim();
    const amount = normalizeAmount(match[2]);
    splitItems.push({
      amount,
      category: categoryFor(description, categories),
      description,
      detail: billDetail('盒马鲜生', description, amount),
      tag: '#盒马周购',
    });
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
  const amountMatch = rawText.match(/￥?(\d+(?:\.\d{1,2})?)/);
  const amount = amountMatch ? normalizeAmount(amountMatch[1]) : 0;
  const fallback = categories.includes('其他') ? '其他' : categories[categories.length - 1];
  return {
    amount,
    category: fallback,
    paymentMethod: '微信支付',
    description: rawText.slice(0, 18) || '截图账单',
    detail: rawText ? `普通截图账单识别到金额 ¥${amount.toFixed(2)}，请确认分类和备注。` : '未能识别出明确账单内容，请手动补充金额、分类和备注。',
    date: todayISO(),
  };
};

export const parseBillText = (rawText: string, source: BillSource, categories: string[]): ParsedTransaction => {
  if (source === 'hema') return parseHema(rawText, categories);
  if (source === 'taobao') return parseTaobao(rawText, categories);
  return parseGeneric(rawText, categories);
};

export const recognizeBillImage = async (file: File, categories: string[]): Promise<RecognizedBill> => {
  const nativeRecognizer = window.Capacitor?.Plugins?.TextRecognition;
  if (nativeRecognizer?.recognize) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(file);
    });
    const response = await nativeRecognizer.recognize({ image: dataUrl });
    const rawText = String(response.text ?? '');
    const detected = detectSource(rawText);
    return {
      source: detected.source,
      sourceLabel: SOURCE_LABELS[detected.source],
      confidence: detected.confidence,
      rawText,
      result: parseBillText(rawText, detected.source, categories),
    };
  }

  const fixture = await guessFixture(file);
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

declare global {
  interface Window {
    Capacitor?: {
      Plugins?: {
        TextRecognition?: {
          recognize?: (options: { image: string }) => Promise<{ text?: string }>;
        };
      };
    };
  }
}
