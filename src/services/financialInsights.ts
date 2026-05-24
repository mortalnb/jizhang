import type { AppSettings, Transaction } from '../types';
import { monthKey, todayISO } from './date';

export interface FinancialInsight {
  title: string;
  body: string;
  tone: 'info' | 'warn' | 'success';
}

export interface InsightResult {
  source: 'local' | 'model';
  enoughDataForModel: boolean;
  insights: FinancialInsight[];
}

interface MonthSummary {
  month: string;
  total: number;
  count: number;
  dailyAverage: number;
  categories: Record<string, number>;
}

const currency = (amount: number) => `¥${amount.toFixed(amount >= 100 ? 0 : 2)}`;

const summarizeByMonth = (transactions: Transaction[]): MonthSummary[] => {
  const groups = transactions.reduce<Record<string, Transaction[]>>((acc, item) => {
    acc[monthKey(item.date)] ??= [];
    acc[monthKey(item.date)].push(item);
    return acc;
  }, {});

  return Object.entries(groups)
    .map(([month, items]) => {
      const total = items.reduce((sum, item) => sum + item.amount, 0);
      const days = new Set(items.map(item => item.date)).size || 1;
      const categories = items.reduce<Record<string, number>>((acc, item) => {
        acc[item.category] = (acc[item.category] ?? 0) + item.amount;
        return acc;
      }, {});

      return {
        month,
        total,
        count: items.length,
        dailyAverage: total / days,
        categories,
      };
    })
    .sort((a, b) => a.month.localeCompare(b.month));
};

const topCategory = (summary?: MonthSummary) => {
  if (!summary) return undefined;
  return Object.entries(summary.categories).sort((a, b) => b[1] - a[1])[0];
};

const categoryDelta = (current?: MonthSummary, previous?: MonthSummary) => {
  if (!current || !previous) return undefined;
  return Object.entries(current.categories)
    .map(([category, amount]) => ({
      category,
      amount,
      previous: previous.categories[category] ?? 0,
      delta: amount - (previous.categories[category] ?? 0),
    }))
    .sort((a, b) => b.delta - a.delta)[0];
};

const allCategoryDeltas = (current?: MonthSummary, previous?: MonthSummary) => {
  if (!current) return [];
  return Object.entries(current.categories)
    .map(([category, amount]) => ({
      category,
      amount: Number(amount.toFixed(2)),
      previous: Number((previous?.categories[category] ?? 0).toFixed(2)),
      delta: Number((amount - (previous?.categories[category] ?? 0)).toFixed(2)),
    }))
    .sort((a, b) => b.delta - a.delta);
};

const tagTotals = (transactions: Transaction[]) => {
  return Object.entries(
    transactions.reduce<Record<string, { amount: number; count: number }>>((acc, item) => {
      if (!item.tag) return acc;
      acc[item.tag] ??= { amount: 0, count: 0 };
      acc[item.tag].amount += item.amount;
      acc[item.tag].count += 1;
      return acc;
    }, {}),
  )
    .map(([tag, value]) => ({
      tag,
      amount: Number(value.amount.toFixed(2)),
      count: value.count,
    }))
    .sort((a, b) => b.amount - a.amount);
};

export const buildLocalInsights = (transactions: Transaction[], budget: number): InsightResult => {
  const summaries = summarizeByMonth(transactions);
  const currentMonth = todayISO().slice(0, 7);
  const current = summaries.find(item => item.month === currentMonth) ?? summaries.at(-1);
  const currentIndex = current ? summaries.findIndex(item => item.month === current.month) : -1;
  const previous = currentIndex > 0 ? summaries[currentIndex - 1] : undefined;
  const top = topCategory(current);
  const biggestRise = categoryDelta(current, previous);
  const insights: FinancialInsight[] = [];

  if (!current || current.count === 0) {
    return {
      source: 'local',
      enoughDataForModel: false,
      insights: [
        {
          title: '数据还不够',
          body: '先记几笔账，我会开始观察预算、分类和月度变化。',
          tone: 'info',
        },
      ],
    };
  }

  const budgetRatio = budget > 0 ? current.total / budget : 0;
  insights.push({
    title: budgetRatio > 0.9 ? '预算接近上限' : budgetRatio > 0.65 ? '预算使用偏快' : '预算节奏正常',
    body: `本月已支出 ${currency(current.total)}，占预算 ${(budgetRatio * 100).toFixed(0)}%。日均约 ${currency(current.dailyAverage)}。`,
    tone: budgetRatio > 0.9 ? 'warn' : budgetRatio > 0.65 ? 'info' : 'success',
  });

  if (previous) {
    const delta = current.total - previous.total;
    const percent = previous.total > 0 ? (delta / previous.total) * 100 : 0;
    insights.push({
      title: delta >= 0 ? '月度支出增加' : '月度支出下降',
      body: `相比 ${previous.month}，当前月份${delta >= 0 ? '多支出' : '少支出'} ${currency(Math.abs(delta))}，变化 ${Math.abs(percent).toFixed(1)}%。`,
      tone: delta > 0 ? 'warn' : 'success',
    });
  } else {
    insights.push({
      title: '缺少上月参照',
      body: '目前还没有连续月份数据，月度对比会在积累到第二个月后更可靠。',
      tone: 'info',
    });
  }

  if (top) {
    const ratio = current.total > 0 ? (top[1] / current.total) * 100 : 0;
    insights.push({
      title: '分类集中度',
      body: `${top[0]} 是本月最高分类，支出 ${currency(top[1])}，占本月 ${ratio.toFixed(0)}%。`,
      tone: ratio > 45 ? 'warn' : 'info',
    });
  }

  if (biggestRise && biggestRise.delta > 0 && previous) {
    insights.push({
      title: '增长最快分类',
      body: `${biggestRise.category} 比上月增加 ${currency(biggestRise.delta)}，可以重点检查是否有一次性支出或可控消费。`,
      tone: 'warn',
    });
  }

  return {
    source: 'local',
    enoughDataForModel: summaries.length >= 2 && current.count >= 8,
    insights: insights.slice(0, 4),
  };
};

const parseModelInsights = (content: string): FinancialInsight[] => {
  const parsed = JSON.parse(content) as { insights?: FinancialInsight[] };
  return (parsed.insights ?? [])
    .filter(item => item.title && item.body)
    .map(item => {
      const tone: FinancialInsight['tone'] = item.tone === 'warn' || item.tone === 'success' ? item.tone : 'info';
      return {
        title: String(item.title).slice(0, 18),
        body: String(item.body).slice(0, 120),
        tone,
      };
    })
    .slice(0, 5);
};

export const generateFinancialInsights = async (
  transactions: Transaction[],
  settings: AppSettings,
): Promise<InsightResult> => {
  const local = buildLocalInsights(transactions, settings.monthlyBudget);
  if (!settings.apiKey.trim() || !local.enoughDataForModel) return local;

  const summaries = summarizeByMonth(transactions).slice(-4);
  const currentMonth = todayISO().slice(0, 7);
  const current = summaries.find(item => item.month === currentMonth) ?? summaries.at(-1);
  const currentIndex = current ? summaries.findIndex(item => item.month === current.month) : -1;
  const previous = currentIndex > 0 ? summaries[currentIndex - 1] : undefined;
  const currentMonthTransactions = current
    ? transactions.filter(item => monthKey(item.date) === current.month)
    : [];
  const daysInCurrentMonth = current ? new Date(Number(current.month.slice(0, 4)), Number(current.month.slice(5, 7)), 0).getDate() : 30;
  const todayDay = current?.month === currentMonth ? Number(todayISO().slice(8, 10)) : daysInCurrentMonth;
  const remainingDays = Math.max(daysInCurrentMonth - todayDay + 1, 1);
  const remainingBudget = Math.max(settings.monthlyBudget - (current?.total ?? 0), 0);
  const financialFacts = {
    currentMonth: current,
    previousMonth: previous,
    budget: settings.monthlyBudget,
    budgetUsedPercent: current && settings.monthlyBudget > 0 ? Number(((current.total / settings.monthlyBudget) * 100).toFixed(1)) : 0,
    remainingBudget: Number(remainingBudget.toFixed(2)),
    remainingDailyTarget: Number((remainingBudget / remainingDays).toFixed(2)),
    categoryDeltas: allCategoryDeltas(current, previous).slice(0, 8),
    tagTotals: tagTotals(currentMonthTransactions).slice(0, 6),
  };
  const recentTransactions = transactions
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30)
    .map(item => ({
      date: item.date,
      amount: item.amount,
      category: item.category,
      description: item.description,
      tag: item.tag,
    }));

  try {
    const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是私人记账分析助手。只允许引用用户提供的 financialFacts 和 recentTransactions 中明确存在的数字、分类、标签和日期，不要估算、不要补全、不要编造笔数或金额。输出多样化但克制的中文洞察。必须返回 JSON：{"insights":[{"title":"短标题","body":"一句具体分析或建议","tone":"info|warn|success"}]}。',
          },
          {
            role: 'user',
            content: JSON.stringify({
              financialFacts,
              monthSummaries: summaries,
              recentTransactions,
              requirements: [
                '至少包含月度对比',
                '至少包含分类结构或异常变化',
                '至少包含一个可执行建议',
                '如果引用标签笔数或金额，必须直接使用 financialFacts.tagTotals 中的值',
                '如果引用分类增减，必须直接使用 financialFacts.categoryDeltas 中的值',
                '避免泛泛而谈，引用具体金额或分类',
              ],
            }),
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const insights = parseModelInsights(payload?.choices?.[0]?.message?.content ?? '');
    return insights.length ? { source: 'model', enoughDataForModel: true, insights } : local;
  } catch (error) {
    console.warn('Financial insight generation failed, using local insights.', error);
    return local;
  }
};
