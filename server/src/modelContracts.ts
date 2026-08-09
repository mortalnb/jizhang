import { z } from 'zod';

const optionalText = (max: number) => z.preprocess(value => typeof value === 'string' && value.trim() ? value : undefined, z.string().max(max).optional());

const splitItemSchema = z.object({
  amount: z.coerce.number().finite().nonnegative(),
  category: z.string().min(1).max(20),
  description: z.string().min(1).max(120),
  detail: optionalText(1000),
  quantity: optionalText(80),
  tag: optionalText(40),
});

const transactionSchema = z.object({
  amount: z.coerce.number().finite().nonnegative(),
  category: z.string().min(1).max(20),
  paymentMethod: z.preprocess(value => typeof value === 'string' ? value : '', z.string().max(40)),
  description: z.string().min(1).max(120),
  detail: optionalText(1500),
  date: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/),
  tag: optionalText(40),
  merchant: optionalText(120),
  orderId: optionalText(120),
  grouping: z.preprocess(value => value === 'folded' || value === 'separate' ? value : undefined, z.enum(['folded', 'separate']).optional()),
  splitItems: z.preprocess(value => Array.isArray(value) ? value : undefined, z.array(splitItemSchema).max(250).optional()),
});

const batchSchema = z.object({
  transactions: z.array(transactionSchema).min(1).max(80),
  warnings: z.preprocess(value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : undefined, z.array(z.string().max(300)).max(30).optional()),
});

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const allowedCategory = (value: string, categories: string[]) => categories.includes(value) ? value : categories.includes('其他') ? '其他' : categories[0];

const firstText = (value: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) if (typeof value[key] === 'string' && String(value[key]).trim()) return String(value[key]).trim();
  return undefined;
};

const normalizeLooseTransaction = (value: unknown, categories: string[]) => {
  if (!isRecord(value)) return value;
  const category = firstText(value, ['category']) ?? (categories.includes('其他') ? '其他' : categories[0]);
  const splitItems = Array.isArray(value.splitItems)
    ? value.splitItems.map(item => {
        if (!isRecord(item)) return item;
        return {
          ...item,
          amount: item.amount ?? item.price ?? item.paidAmount,
          category: firstText(item, ['category']) ?? category,
          description: firstText(item, ['description', 'name', 'itemName', 'productName', 'title']) ?? '商品明细',
          quantity: firstText(item, ['quantity', 'count', 'unit']),
        };
      })
    : value.splitItems;
  return {
    ...value,
    amount: value.amount ?? value.paidAmount ?? value.total,
    category,
    description: firstText(value, ['description', 'title', 'merchant']) ?? '消费记录',
    paymentMethod: firstText(value, ['paymentMethod', 'payment']) ?? '',
    splitItems,
  };
};

export const normalizeModelBatch = (value: unknown, categories: string[]) => {
  if (!isRecord(value)) throw new Error('model result is not an object');
  const transactions = (Array.isArray(value.transactions) ? value.transactions : [value]).map(transaction => normalizeLooseTransaction(transaction, categories));
  const parsed = batchSchema.parse({ transactions, warnings: value.warnings });
  return {
    ...parsed,
    transactions: parsed.transactions.map(transaction => ({
      ...transaction,
      category: allowedCategory(transaction.category, categories),
      grouping: transaction.splitItems?.length ? 'folded' as const : transaction.grouping ?? 'separate' as const,
      splitItems: transaction.splitItems?.map(item => ({ ...item, category: allowedCategory(item.category, categories) })),
    })),
  };
};

export const normalizeVisionBatch = (value: unknown, categories: string[]) => {
  if (!isRecord(value)) throw new Error('vision result is not an object');
  const batch = normalizeModelBatch(value, categories);
  return {
    amount: Number(value.amount) || Number(batch.transactions.reduce((sum, transaction) => sum + transaction.amount, 0).toFixed(2)),
    source: typeof value.source === 'string' ? value.source : 'generic',
    sourceLabel: typeof value.sourceLabel === 'string' ? value.sourceLabel : undefined,
    transactions: batch.transactions,
    warnings: batch.warnings,
  };
};

export const buildTransactionPrompt = (categories: string[], today: string) => `你是记账助手。只返回一个 JSON 对象，最外层格式固定为 {"transactions":[...],"warnings":[]}。
每个 transactions 元素表示一笔真实、独立发生的消费，字段为 amount, category, paymentMethod, description, detail, date, tag, merchant, orderId, grouping, splitItems。category 必须属于：${categories.join(', ')}。
不同日期、不同付款行为、不同订单号或语义上独立发生的消费必须分别放入 transactions，绝不能把跨日期金额相加成一笔。
同一次结账或同一个订单里的商品明细保留为一笔 transaction，并放入 splitItems，grouping=folded。
盒马、沃尔玛、山姆及其他超市的一张小票/一次结账默认折叠为一笔；淘宝/天猫同一订单可折叠，多个订单、不同日期或多次实付款必须拆成多笔。
每笔交易的日期和支付方式都要从对应原句独立提取，不能把第一笔的支付方式复用到后续交易。
父级 amount 是实际支付总额；优惠导致商品合计不同于实付时保留实付总额并在 detail 说明。date 必须为 YYYY-MM-DD；信息缺失不要编造。
AA 或多人分摊只记录用户最终承担净支出，作为单笔 transaction 且不要生成 splitItems。若有实际付款和回款，amount=付款-回款；只有明确平均 AA 且没有实际回款时才按人数平均。
示例：“我付了 120，他转我 60”返回 60；“3 个人吃饭花了 300，是 AA 的”返回 100；“两人吃饭 163，我付的，他只转我 80”返回 83。
今天是 ${today}。`;

export const buildVisionPrompt = (categories: string[], today: string) =>
  `你是记账截图识别助手。只返回 JSON，最外层字段：source, sourceLabel, amount, transactions, warnings。` +
  `transactions 每笔字段：amount, category, paymentMethod, description, detail, date, tag, merchant, orderId, grouping, splitItems；splitItems 每项字段：amount, category, description, detail, quantity, tag。` +
  `category 必须属于：${categories.join(', ')}。` +
  `盒马、沃尔玛、山姆或其他超市的一张小票/一次结账必须返回一笔 transaction，grouping=folded，逐商品放入 splitItems；父级 amount 是优惠后的实际支付总额，quantity 保留数量和单位。` +
  `淘宝/天猫同一订单的商品可折叠；订单列表中的多个订单、不同日期或多次实付款必须返回多笔 transactions，绝不能合并金额。` +
  `看不到的字段留空，不得编造。今天是 ${today}。`;
