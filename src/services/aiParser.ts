import type { AppSettings, ParsedTransaction, SplitItem } from '../types';
import { cloudApi } from './cloudApi';
import { todayISO } from './date';
import { storage } from './storage';

const PAYMENT_METHODS = ['微信支付', '支付宝', '银行卡', '现金'];

const findCategory = (text: string, categories: string[]) => {
  const direct = categories.find(category => text.includes(category));
  if (direct) return direct;

  if (/咖啡|奶茶|饮料|可乐|茶饮|啤酒|酒水|果汁|美式|拿铁/.test(text)) return categories.includes('饮料') ? '饮料' : categories[0];
  if (/薯片|饼干|糖果|巧克力|坚果|零食/.test(text)) return categories.includes('零食') ? '零食' : categories[0];
  if (/苹果|香蕉|橙子|葡萄|草莓|水果|果切/.test(text)) return categories.includes('水果') ? '水果' : categories[0];
  if (/大模型|模型token|token|API充值|ChatGPT|Claude|Gemini|AI订阅|AI服务/i.test(text)) return categories.includes('AI服务') ? 'AI服务' : categories[0];
  if (/饭|餐|面包|果蔬|蔬菜|鸡蛋|肉|虾|外卖|火锅|麦当劳|盒马|食材/.test(text)) return categories.includes('餐费') ? '餐费' : categories[0];
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
  if (/盒马|每周|周购|补给/.test(text)) return '#盒马周购';
  if (/淘宝|天猫|订单|购物/.test(text)) return '#淘宝网购';
  if (/加油|汽油|油费/.test(text)) return '#加油';
  return undefined;
};

const detectPayment = (text: string) => {
  if (text.includes('支付宝') || text.includes('花呗')) return '支付宝';
  if (text.includes('银行卡')) return '银行卡';
  if (text.includes('现金')) return '现金';
  return '微信支付';
};

const extractAmount = (text: string) => {
  const match = text.match(/(?:￥|¥|元|花了|支付|实付)?\s*(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : 0;
};

const compactDescription = (value: string | undefined, category: string) => {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? '';
  const fallback = `${category}支出`;
  if (!normalized) return fallback;
  if (/根据|识别|归类|金额|原始描述|消费场景|拆单依据/.test(normalized)) return fallback;
  const firstClause = normalized.split(/[。；;，,]/)[0]?.trim() || normalized;
  return firstClause.length > 18 ? `${firstClause.slice(0, 18)}...` : firstClause;
};

const extractJsonObject = (value: string) => {
  const cleaned = value.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI response is not JSON');
  return cleaned.slice(start, end + 1);
};

const parseSplitItems = (text: string, categories: string[], tag?: string): SplitItem[] => {
  const normalized = text.replace(/[，；;]/g, ',');
  const parts = normalized.split(',').map(part => part.trim()).filter(Boolean);
  const items = parts.flatMap(part => {
    const match = part.match(/(.+?)\s*(\d+(?:\.\d{1,2})?)\s*(?:元)?$/);
    if (!match) return [];
    const description = match[1].replace(/^其中/, '').trim();
    const amount = Number(match[2]);
    if (!description || amount <= 0) return [];
    const category = findCategory(description, categories);
    return [{ amount, description: compactDescription(description, category), category, tag }];
  });

  return items.length > 1 ? items : [];
};

const buildDetail = (text: string, category: string, amount: number, splitCount = 0) => {
  const source = text.replace(/\s+/g, ' ').trim();
  const amountText = amount > 0 ? `金额 ¥${amount.toFixed(2)}` : '金额待确认';
  const splitText = splitCount > 1 ? `，识别为 ${splitCount} 个拆单项目` : '';
  return `根据输入内容归类为「${category}」，${amountText}${splitText}。原始描述：${source.slice(0, 60) || '未提供更多备注'}。`;
};

const localParse = (text: string, categories: string[]): ParsedTransaction => {
  const tag = detectTag(text);
  const splitItems = text.includes('其中') ? parseSplitItems(text.split('其中')[1] ?? '', categories, tag) : parseSplitItems(text, categories, tag);

  if (splitItems.length > 1) {
    const amount = Number(splitItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
    return {
      amount,
      category: splitItems[0].category,
      paymentMethod: detectPayment(text),
      description: tag ? `${tag.replace('#', '')}拆单` : '混合消费拆单',
      detail: buildDetail(text, splitItems[0].category, amount, splitItems.length),
      date: todayISO(),
      tag,
      splitItems: splitItems.map(item => ({
        ...item,
        detail: buildDetail(item.description, item.category, item.amount),
      })),
    };
  }

  const amount = extractAmount(text);
  const category = findCategory(text, categories);
  return {
    amount,
    category,
    paymentMethod: detectPayment(text),
    description: compactDescription(text, category),
    detail: buildDetail(text, category, amount),
    date: todayISO(),
    tag,
  };
};

const normalizeRemoteResult = (parsed: Partial<ParsedTransaction>, text: string, categories: string[]): ParsedTransaction => {
  const category = parsed.category && categories.includes(parsed.category) ? parsed.category : findCategory(text, categories);
  const splitItems = parsed.splitItems?.map(item => ({
    amount: Number(item.amount) || 0,
    category: categories.includes(item.category) ? item.category : category,
    description: compactDescription(item.description, categories.includes(item.category) ? item.category : category),
    detail: item.detail || parsed.detail,
    tag: item.tag ?? parsed.tag,
  }));

  const amount = splitItems?.length
    ? Number(splitItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2))
    : Number(parsed.amount) || extractAmount(text);

  return {
    amount,
    category,
    paymentMethod: parsed.paymentMethod && PAYMENT_METHODS.includes(parsed.paymentMethod) ? parsed.paymentMethod : detectPayment(text),
    description: compactDescription(parsed.description || text, category),
    detail: parsed.detail || buildDetail(text, category, amount, splitItems?.length ?? 0),
    date: parsed.date || todayISO(),
    tag: parsed.tag,
    splitItems,
  };
};

export const aiParser = {
  async parse(text: string, settings: AppSettings): Promise<ParsedTransaction> {
    const categories = settings.categories.length ? settings.categories : ['其他'];
    if (settings.aiMode === 'cloud') {
      if (!storage.getCloudSession()?.accessToken) throw new Error('云端模式未登录，请先登录云端服务或切换到自填模型');
      const cloudResult = await cloudApi.parseTransaction(settings, text, categories);
      return normalizeRemoteResult(cloudResult, text, categories);
    }

    const useDevProxy = import.meta.env.DEV;
    if (!settings.apiKey.trim() && !useDevProxy) {
      await new Promise(resolve => setTimeout(resolve, 450));
      return localParse(text, categories);
    }

    try {
      const response = await fetch(useDevProxy ? '/__dev_mimo_chat' : `${settings.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(useDevProxy ? {} : { Authorization: `Bearer ${settings.apiKey}` }),
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0.1,
          max_completion_tokens: 2048,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `你是记账助手。请从用户输入中提取 JSON：amount, category, paymentMethod, description, detail, date, tag, splitItems。splitItems 的每一项可包含 amount, category, description, detail, tag。category 必须属于：${categories.join(', ')}。description 必须是适合账单列表展示的凝练标题，4 到 12 个中文字符左右，不要写解释。detail 用一句稍微更详细的中文说明消费场景、归类依据或拆单依据，避免编造不存在的商户和金额。

AA 或多人分摊场景只记录用户最终承担的净支出，必须返回单笔账单，不要生成 splitItems。金额判断优先级：如果提供了用户实际付款和收到的回款，amount 等于实际付款减去回款；如果提供了实际转账金额，不得强制按人数平均；只有明确说明平均 AA 且没有提供实际回款金额时，才用总金额除以人数。
示例：“我付了 120，他转我 60”应返回 amount 60；“3 个人吃饭花了 300，是 AA 的”应返回 amount 100；“两人吃饭 163，我付的，他只转我 80”应返回 amount 83。AA 场景的 detail 应说明这是用户最终承担金额。

今天是 ${todayISO()}。只返回 JSON。`,
            },
            { role: 'user', content: text },
          ],
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.message?.reasoning_content;
      return normalizeRemoteResult(JSON.parse(extractJsonObject(String(content))), text, categories);
    } catch (error) {
      console.warn('AI parse failed, falling back to local parser.', error);
      return localParse(text, categories);
    }
  },
};
