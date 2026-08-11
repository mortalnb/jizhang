import type { AppSettings, ParsedBatch, ParsedTransaction, SplitItem } from '../types';
import { cloudApi } from './cloudApi';
import { todayISO } from './date';
import { normalizeMerchant, normalizeScenarioTag } from './ledgerNormalization';
import { storage } from './storage';

const findCategory = (text: string, categories: string[]) => {
  const direct = categories.find(category => text.includes(category));
  if (direct) return direct;
  if (/咖啡|奶茶|饮料|可乐|茶饮|啤酒|酒水|果汁|美式|拿铁/.test(text)) return categories.includes('饮料') ? '饮料' : categories[0];
  if (/薯片|饼干|糖果|巧克力|坚果|零食/.test(text)) return categories.includes('零食') ? '零食' : categories[0];
  if (/苹果|香蕉|橙子|葡萄|草莓|水果|果切/.test(text)) return categories.includes('水果') ? '水果' : categories[0];
  if (/大模型|模型token|token|API充值|ChatGPT|Claude|Gemini|AI订阅|AI服务/i.test(text)) return categories.includes('AI服务') ? 'AI服务' : categories[0];
  if (/饭|餐|面包|果蔬|蔬菜|鸡蛋|肉|虾|外卖|火锅|麦当劳|盒马|沃尔玛|食材/.test(text)) return categories.includes('餐费') ? '餐费' : categories[0];
  if (/地铁|公交|打车|网约车|加油|停车/.test(text)) return categories.includes('交通') ? '交通' : categories[0];
  if (/电影|游戏|演出|音乐|会员/.test(text)) return categories.includes('娱乐') ? '娱乐' : categories[0];
  if (/纸巾|洗|清洁|超市|日用|牙膏/.test(text)) return categories.includes('日用') ? '日用' : categories[0];
  if (/衣|裤|鞋|帽|T 恤|T恤/.test(text)) return categories.includes('服饰') ? '服饰' : categories[0];
  if (/手机|耳机|电脑|充电|数码/.test(text)) return categories.includes('数码') ? '数码' : categories[0];
  if (/水费|电费|燃气|煤气|物业|话费|网费|宽带|交费|缴费|充值/.test(text)) return categories.includes('交费') ? '交费' : categories[0];
  if (/维修|修理|保养|换屏|补胎|售后|配件|安装/.test(text)) return categories.includes('维修') ? '维修' : categories[0];
  return categories.includes('其他') ? '其他' : categories[categories.length - 1];
};

const detectTag = (text: string) => {
  if (/盒马|沃尔玛|山姆|超市|周购|补给/.test(text)) return '超市采购';
  if (/淘宝|天猫|网购/.test(text)) return '网购';
  if (/加油|汽油|油费/.test(text)) return '加油';
  return undefined;
};

const extractAmount = (text: string) => {
  const matches = [...text.matchAll(/(?:￥|¥)?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块)/g)].map(match => Number(match[1]));
  return matches.length ? matches[matches.length - 1] : 0;
};

const compactDescription = (value: string | undefined, category: string) => {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  const fallback = `${category}支出`;
  if (!normalized) return fallback;
  if (/根据|识别|归类|金额|原始描述|消费场景|拆单依据/.test(normalized)) return fallback;
  const withoutDate = normalized.replace(/^(?:今天|昨天|前天|\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}月\d{1,2}日)[，,：:\s]*/, '');
  const firstClause = withoutDate.split(/[。；;，,]/)[0]?.trim() || withoutDate;
  return firstClause.length > 18 ? `${firstClause.slice(0, 18)}...` : firstClause;
};

const extractJsonObject = (value: string) => {
  const cleaned = value.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI response is not JSON');
  return cleaned.slice(start, end + 1);
};

const parseSplitItems = (text: string, categories: string[]): SplitItem[] => {
  const itemText = text.includes('其中') ? text.split('其中').slice(1).join('其中') : text;
  const parts = itemText.replace(/[，；;]/g, ',').split(',').map(part => part.trim()).filter(Boolean);
  const items = parts.flatMap(part => {
    const match = part.match(/(.+?)\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块)$/);
    if (!match) return [];
    const description = match[1].trim();
    const amount = Number(match[2]);
    if (!description || amount <= 0) return [];
    const category = findCategory(description, categories);
    return [{ amount, description: compactDescription(description, category), category }];
  });
  return items.length > 1 ? items : [];
};

const buildDetail = (text: string, category: string, amount: number, splitCount = 0) => {
  const source = text.replace(/\s+/g, ' ').trim();
  return `根据输入归类为「${category}」，${amount > 0 ? `金额 ¥${amount.toFixed(2)}` : '金额待确认'}${splitCount > 1 ? `，含 ${splitCount} 个同笔消费项目` : ''}。原始描述：${source.slice(0, 80) || '未提供更多备注'}。`;
};

const dateFromText = (text: string) => {
  const full = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
  if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
  const monthDay = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (monthDay) return `${todayISO().slice(0, 4)}-${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}`;
  const offset = text.includes('前天') ? 2 : text.includes('昨天') ? 1 : 0;
  if (!offset) return todayISO();
  const date = new Date(`${todayISO()}T12:00:00+08:00`);
  date.setDate(date.getDate() - offset);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
};

const localTransaction = (text: string, categories: string[]): ParsedTransaction => {
  const tag = detectTag(text);
  const splitItems = parseSplitItems(text, categories);
  const paidAmount = extractAmount(text);
  const amount = paidAmount || Number(splitItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
  const category = splitItems[0]?.category ?? findCategory(text, categories);
  return {
    amount,
    category,
    description: splitItems.length ? (/盒马|沃尔玛|山姆|超市/.test(text) ? '超市采购' : '组合消费') : compactDescription(text, category),
    detail: buildDetail(text, category, amount, splitItems.length),
    date: dateFromText(text),
    tag,
    merchant: normalizeMerchant({ description: text }),
    grouping: splitItems.length ? 'folded' : 'separate',
    splitItems: splitItems.length ? splitItems.map(item => ({ ...item, detail: buildDetail(item.description, item.category, item.amount) })) : undefined,
  };
};

const splitIndependentEntries = (text: string) => {
  const lines = text
    .replace(/([。！？!?])\s*(?=(?:今天|昨天|前天|20\d{2}[-/.年]|\d{1,2}月\d{1,2}日))/g, '$1\n')
    .split(/\n|[；;]/)
    .map(value => value.trim())
    .filter(Boolean);
  return lines.length > 1 && lines.filter(line => /\d+(?:\.\d{1,2})?\s*(?:元|块)/.test(line)).length > 1 ? lines : [text.trim()];
};

const localParse = (text: string, categories: string[]): ParsedBatch => ({
  transactions: splitIndependentEntries(text).map(entry => localTransaction(entry, categories)),
});

const validDate = (value: unknown) => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value);
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const firstText = (value: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) if (typeof value[key] === 'string' && String(value[key]).trim()) return String(value[key]).trim();
  return undefined;
};

const normalizeRemoteTransaction = (parsed: Record<string, unknown>, text: string, categories: string[]): ParsedTransaction => {
  const parsedCategory = typeof parsed.category === 'string' ? parsed.category : '';
  const category = categories.includes(parsedCategory) ? parsedCategory : findCategory(`${text} ${parsedCategory}`, categories);
  const parsedTag = normalizeScenarioTag(parsed.tag);
  const rawSplitItems = Array.isArray(parsed.splitItems) ? parsed.splitItems : Array.isArray(parsed.lineItems) ? parsed.lineItems : undefined;
  const splitItems = rawSplitItems
    ? rawSplitItems.flatMap(raw => {
        if (!isObject(raw)) return [];
        const amount = Number(raw.amount ?? raw.price ?? raw.paidAmount) || 0;
        const description = firstText(raw, ['description', 'name', 'itemName', 'productName', 'title']) ?? '';
        if (amount <= 0 || !description.trim()) return [];
        const rawCategory = typeof raw.category === 'string' ? raw.category : '';
        const itemCategory = categories.includes(rawCategory) ? rawCategory : findCategory(description, categories);
        return [{
          amount: Number(amount.toFixed(2)),
          category: itemCategory,
          description: compactDescription(description, itemCategory),
          detail: typeof raw.detail === 'string' ? raw.detail : undefined,
          quantity: firstText(raw, ['quantity', 'count', 'unit']),
        } satisfies SplitItem];
      })
    : undefined;
  const parsedAmount = Number(parsed.amount ?? parsed.paidAmount ?? parsed.total) || 0;
  const itemTotal = Number((splitItems ?? []).reduce((sum, item) => sum + item.amount, 0).toFixed(2));
  const amount = parsedAmount || itemTotal || extractAmount(text);
  const mismatch = parsedAmount > 0 && itemTotal > 0 && Math.abs(parsedAmount - itemTotal) > 0.05;
  const detail = typeof parsed.detail === 'string' ? parsed.detail : buildDetail(text, category, amount, splitItems?.length ?? 0);
  return {
    amount: Number(amount.toFixed(2)),
    category,
    description: compactDescription(firstText(parsed, ['description', 'title', 'merchant']) ?? text, category),
    detail: mismatch ? `${detail} 商品明细合计 ¥${itemTotal.toFixed(2)}，与实付 ¥${parsedAmount.toFixed(2)} 不同，已保留实付金额。` : detail,
    date: validDate(parsed.date) ? String(parsed.date) : dateFromText(text),
    tag: parsedTag,
    merchant: normalizeMerchant({ description: text, detail, merchant: firstText(parsed, ['merchant', 'store']) }),
    orderId: firstText(parsed, ['orderId', 'orderNumber']),
    grouping: parsed.grouping === 'folded' || splitItems?.length ? 'folded' : 'separate',
    splitItems: splitItems?.length ? splitItems : undefined,
  };
};

export const normalizeParsedBatch = (value: unknown, text: string, categories: string[]): ParsedBatch => {
  if (!isObject(value)) return localParse(text, categories);
  const rawTransactions = Array.isArray(value.transactions) ? value.transactions : [value];
  const sourceEntries = splitIndependentEntries(text);
  const transactions = rawTransactions
    .filter(isObject)
    .map((transaction, index) => normalizeRemoteTransaction(transaction, sourceEntries[index] ?? text, categories))
    .filter(transaction => transaction.amount > 0 || transaction.description);
  if (!transactions.length) return localParse(text, categories);
  return {
    transactions,
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === 'string') : undefined,
  };
};

export const buildTransactionPrompt = (categories: string[]) => `你是记账助手。只返回一个 JSON 对象，最外层格式固定为 {"transactions":[...],"warnings":[]}。
每个 transactions 元素表示一笔真实、独立发生的消费，字段为 amount, category, description, detail, date, tag, merchant, orderId, grouping, splitItems。category 必须属于：${categories.join(', ')}。

拆分原则：
1. 不同日期、不同付款行为、不同订单号或语义上独立发生的消费，必须分别放入 transactions；绝不能把跨日期金额相加成一笔。
2. 同一次结账或同一个订单里的商品明细，保留为一笔 transaction，并放入 splitItems，grouping 返回 folded。
3. 盒马、沃尔玛、山姆及其他超市的一张小票/一次结账默认折叠为一笔，splitItems 逐商品列出。
4. 淘宝/天猫：同一个订单的多个商品可折叠；订单列表中的多个订单、不同日期或多次实付款必须拆成多笔 transactions。
5. 每笔交易的日期都要从对应原句独立提取；账本不保存支付方式，不要返回 paymentMethod。
6. splitItems 每项只包含 amount, category, description, detail, quantity。父级 amount 是实际支付总额；优惠导致商品合计不同于实付时保留实付总额，并在 detail 说明。
7. tag 是整笔交易可选的单一场景标签，只能返回 0 或 1 个短词；禁止数组、多个标签、逗号分隔和 # 前缀，也不能把商户、分类或支付方式当作标签。merchant 只在原文明确出现品牌或平台时填写。
8. description 为 4 到 12 个中文字符左右的账单标题；date 必须为 YYYY-MM-DD。信息缺失时不要编造。

AA 或多人分摊只记录用户最终承担的净支出，作为单笔 transaction 且不要生成 splitItems。若提供实际付款和回款，amount=付款-回款；只有明确平均 AA 且没有实际回款时才按人数平均。
示例：“我付了 120，他转我 60”返回 60；“3 个人吃饭花了 300，是 AA 的”返回 100；“两人吃饭 163，我付的，他只转我 80”返回 83。

今天是 ${todayISO()}。`;

export const aiParser = {
  async parse(text: string, settings: AppSettings): Promise<ParsedBatch> {
    const categories = settings.categories.length ? settings.categories : ['其他'];
    if (settings.aiMode === 'cloud') {
      if (!storage.getCloudSession()?.accessToken) throw new Error('云端模式未登录，请先登录云端服务或切换到自填模型');
      return normalizeParsedBatch(await cloudApi.parseTransaction(settings, text, categories), text, categories);
    }

    const useDevProxy = import.meta.env.DEV;
    if (!settings.apiKey.trim() && !useDevProxy) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return localParse(text, categories);
    }

    try {
      const response = await fetch(useDevProxy ? '/__dev_mimo_chat' : `${settings.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(useDevProxy ? {} : { Authorization: `Bearer ${settings.apiKey}` }),
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0.1,
          max_completion_tokens: 4096,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: buildTransactionPrompt(categories) },
            { role: 'user', content: text },
          ],
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.message?.reasoning_content;
      return normalizeParsedBatch(JSON.parse(extractJsonObject(String(content))), text, categories);
    } catch (error) {
      console.warn('AI batch parse failed, falling back to local parser.', error);
      return localParse(text, categories);
    }
  },
};
