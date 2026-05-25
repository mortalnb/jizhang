import type { AppSettings, ParsedTransaction, SplitItem } from '../types';
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

export const detectKnownBillFixture = (width: number, height: number, size: number) =>
  BILL_FIXTURES.find(
    fixture =>
      fixture.width === width &&
      fixture.height === height &&
      size >= fixture.minSize &&
      size <= fixture.maxSize,
  );

const detectSource = (rawText: string): { source: BillSource; confidence: number } => {
  if (/盒马|交易完成|规格|单价/.test(rawText)) return { source: 'hema', confidence: 0.95 };
  if (/淘宝|天猫|全部订单|实付款|已发货|Turnitin/i.test(rawText)) return { source: 'taobao', confidence: 0.92 };
  return { source: 'generic', confidence: 0.45 };
};

const categoryFor = (description: string, categories: string[]) => {
  if (/洗发|食用冰杯|日用|纸巾|清洁/.test(description)) return categories.includes('日用') ? '日用' : categories[0];
  if (/拖鞋|鞋|衣|裤/.test(description)) return categories.includes('服饰') ? '服饰' : categories[0];
  if (/检测|查重|服务|Turnitin/i.test(description)) return categories.includes('其他') ? '其他' : categories[categories.length - 1];
  if (/咖啡|啤酒|Heineken|喜力|饮料|奶茶|茶饮|美式|拿铁|牛奶|发酵乳|水杯|冰杯/.test(description)) return categories.includes('饮料') ? '饮料' : categories[0];
  if (/虾|鸡蛋|提|水果|果蔬|面包|餐|食材|冰淇淋|水饺|馒头|牛肉|番茄|蒜米|金果|藜麦|鸡排|馅饼/.test(description)) return categories.includes('餐费') ? '餐费' : categories[0];
  return categories.includes('其他') ? '其他' : categories[categories.length - 1];
};

const normalizeAmount = (value: string) => Number(Number(value).toFixed(2));
const normalizeBillText = (rawText: string) =>
  rawText
    .replace(/[¥￥]\s*/g, ' ￥')
    .replace(/[×x]\s*(\d+)/gi, ' $1件')
    .replace(/\r/g, '\n');

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
    .replace(/\s+/g, ' ')
    .trim();

const parseItemLine = (line: string) => {
  const normalized = line.replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^(.+?)\s+[￥¥](\d+(?:\.\d{1,2})?)\s+(\d+[^\s]*)$/);
  if (!match) return undefined;
  return {
    description: cleanDescription(match[1]),
    amount: normalizeAmount(match[2]),
    quantity: match[3].trim(),
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

    const amountMatch = current.match(/^[￥¥]\s*(\d+(?:\.\d{1,2})?)$/) || current.match(/^(\d+(?:\.\d{1,2})?)$/);
    if (!amountMatch) continue;

    const previous = lines[index - 1] ?? '';
    const next = lines[index + 1] ?? '';
    const quantityMatch = next.match(/^(\d+[盒袋杯瓶份件只枚袋包罐台个张次]?)/);
    if (!previous || isNoiseLine(previous)) continue;

    items.push({
      description: cleanDescription(previous),
      amount: normalizeAmount(amountMatch[1]),
      quantity: quantityMatch?.[1] ?? '1件',
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
      : '未能从文本中识别出可信金额。为避免误记，已保留为 0 元，请手动确认。',
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

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });

const imageToVisionDataUrl = async (file: File) => {
  const original = await fileToDataUrl(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = original;
  });

  const ratio = image.height / Math.max(image.width, 1);
  const targetWidth = ratio > 3 ? 720 : 960;
  if (file.size <= 900_000 && image.width <= targetWidth) return original;

  const width = Math.min(image.width, targetWidth);
  const height = Math.round(image.height * (width / image.width));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return original;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.82);
};

const parseJsonContent = (content: string) => {
  const normalized = content
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('视觉模型未返回 JSON');
  return JSON.parse(normalized.slice(start, end + 1));
};

const compactTitle = (value: string | undefined, fallback: string) => {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (!normalized) return fallback;
  const firstClause = normalized.split(/[。；;，,]/)[0]?.trim() || normalized;
  return firstClause.length > 18 ? `${firstClause.slice(0, 18)}...` : firstClause;
};

const normalizeVisionResult = (parsed: Partial<ParsedTransaction>, categories: string[]): ParsedTransaction => {
  const fallbackCategory = categories.includes('其他') ? '其他' : categories[categories.length - 1];
  const splitItems = parsed.splitItems
    ?.map(item => {
      const amount = normalizeAmount(String(item.amount || 0));
      const category = categories.includes(item.category) ? item.category : categoryFor(`${item.description} ${item.detail ?? ''}`, categories);
      return {
        amount,
        category,
        description: compactTitle(item.description, `${category}项目`),
        detail: item.detail || `${item.description || category}，金额 ¥${amount.toFixed(2)}。`,
        tag: item.tag ?? parsed.tag,
      };
    })
    .filter(item => item.amount > 0 && item.description);

  const amount = splitItems?.length
    ? normalizeAmount(String(splitItems.reduce((sum, item) => sum + item.amount, 0)))
    : normalizeAmount(String(parsed.amount || 0));
  const category = parsed.category && categories.includes(parsed.category) ? parsed.category : splitItems?.[0]?.category ?? fallbackCategory;

  return {
    amount,
    category,
    paymentMethod: '',
    description: compactTitle(parsed.description, splitItems?.length ? '截图账单拆单' : '截图账单'),
    detail:
      parsed.detail ||
      (splitItems?.length
        ? `视觉模型从截图中识别出 ${splitItems.length} 个明细项目，总金额 ¥${amount.toFixed(2)}，请保存前确认。`
        : `视觉模型从截图中识别到金额 ¥${amount.toFixed(2)}，请保存前确认。`),
    date: parsed.date || todayISO(),
    tag: parsed.tag,
    splitItems: splitItems?.length ? splitItems : undefined,
  };
};

const buildVisionPrompt = (categories: string[]) =>
  `你是记账截图识别助手。请直接读取图片中的账单、订单或商品列表，返回严格 JSON，不要输出解释。
JSON 字段：amount, category, paymentMethod, description, detail, date, tag, splitItems。
要求：
- category 必须属于：${categories.join(', ')}
- description 是明细主页面显示的凝练标题，4 到 12 个中文字符左右
- detail 是点开后显示的稍详细说明，包含来源、商品/服务、数量或归类依据，不要编造看不到的信息
- 如果截图里有多个商品或订单，放入 splitItems，每项包含 amount, category, description, detail, tag
- amount 为总金额；如果有 splitItems，amount 等于 splitItems 金额合计
- paymentMethod 如果截图没有明确写明则返回空字符串
- date 如果截图没有明确日期则返回 ${todayISO()}
- 不要把状态栏时间、电量、规格重量、订单号当成金额`;

export const parseBillText = (rawText: string, source: BillSource, categories: string[]): ParsedTransaction => {
  if (source === 'hema') return parseHema(rawText, categories);
  if (source === 'taobao') return parseTaobao(rawText, categories);
  return parseGeneric(rawText, categories);
};

export const recognizeBillImage = async (file: File, settings: AppSettings): Promise<RecognizedBill> => {
  const categories = settings.categories.length ? settings.categories : ['其他'];

  if (!settings.apiKey.trim()) {
    throw new Error('请先在设置中填写硅基流动 API Key，再使用视觉模型识别截图。');
  }

  const dataUrl = await imageToVisionDataUrl(file);
  const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.1,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildVisionPrompt(categories) },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
                detail: 'high',
              },
            },
            {
              type: 'text',
              text: '请识别这张截图并返回严格 JSON。',
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`视觉模型识别失败：HTTP ${response.status}`);
  const payload = await response.json();
  const content = String(payload?.choices?.[0]?.message?.content ?? '');
  const result = normalizeVisionResult(parseJsonContent(content), categories);
  const detected = detectSource(`${content} ${result.description} ${result.detail ?? ''}`);

  return {
    source: detected.source,
    sourceLabel: SOURCE_LABELS[detected.source],
    confidence: detected.confidence,
    rawText: content,
    result,
  };
};

