import type { AppSettings, Transaction } from '../types';
import { cloudApi } from './cloudApi';
import { monthKey, todayISO } from './date';
import { ledgerItemsForStats, tagCoverage } from './ledgerAnalytics';
import { storage } from './storage';

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
  elapsedDays: number;
  firstDate: string;
  lastDate: string;
  isComplete: boolean;
}

const currency = (amount: number) => `¥${amount.toFixed(amount >= 100 ? 0 : 2)}`;
const dayOf = (date: string) => Number(date.slice(8, 10));
const daysInMonth = (month: string) => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();

const summarizeByMonth = (transactions: Transaction[]): MonthSummary[] => {
  const transactionGroups = transactions.reduce<Record<string, Transaction[]>>((groups, transaction) => {
    const month = monthKey(transaction.date);
    groups[month] ??= [];
    groups[month].push(transaction);
    return groups;
  }, {});
  const months = Object.keys(transactionGroups).sort();
  const firstMonth = months[0];
  const currentMonth = todayISO().slice(0, 7);

  return months.map(month => {
    const monthTransactions = transactionGroups[month];
    const dates = monthTransactions.map(item => item.date).sort();
    const total = Number(monthTransactions.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
    const categories = ledgerItemsForStats(monthTransactions).reduce<Record<string, number>>((totals, item) => {
      totals[item.category] = (totals[item.category] ?? 0) + item.amount;
      return totals;
    }, {});
    for (const category of Object.keys(categories)) categories[category] = Number(categories[category].toFixed(2));
    const currentElapsed = month === currentMonth ? Math.min(dayOf(todayISO()), dayOf(dates.at(-1) ?? todayISO()), daysInMonth(month)) : daysInMonth(month);
    const boundaryPartial = month === firstMonth && dayOf(dates[0]) > 3;
    return {
      month,
      total,
      count: monthTransactions.length,
      dailyAverage: total / Math.max(currentElapsed, 1),
      categories,
      elapsedDays: currentElapsed,
      firstDate: dates[0],
      lastDate: dates.at(-1) ?? dates[0],
      isComplete: month < currentMonth && !boundaryPartial,
    };
  });
};

const topCategory = (summary?: MonthSummary) =>
  summary ? Object.entries(summary.categories).sort((left, right) => right[1] - left[1])[0] : undefined;

const allCategoryDeltas = (current?: MonthSummary, previous?: MonthSummary) => {
  if (!current) return [];
  return Object.entries(current.categories)
    .map(([category, amount]) => ({
      category,
      amount: Number(amount.toFixed(2)),
      previous: Number((previous?.categories[category] ?? 0).toFixed(2)),
      delta: Number((amount - (previous?.categories[category] ?? 0)).toFixed(2)),
    }))
    .sort((left, right) => right.delta - left.delta);
};

const tagTotals = (transactions: Transaction[]) =>
  Object.entries(
    ledgerItemsForStats(transactions).reduce<Record<string, { amount: number; parents: Set<string> }>>((totals, item) => {
      if (!item.tag) return totals;
      totals[item.tag] ??= { amount: 0, parents: new Set<string>() };
      totals[item.tag].amount += item.amount;
      totals[item.tag].parents.add(item.parentId);
      return totals;
    }, {}),
  )
    .map(([tag, value]) => ({ tag, amount: Number(value.amount.toFixed(2)), count: value.parents.size }))
    .sort((left, right) => right.amount - left.amount);

const samePeriodComparison = (transactions: Transaction[], month: string, cutoff = dayOf(todayISO())) => {
  const currentMonth = todayISO().slice(0, 7);
  if (month !== currentMonth) return undefined;
  const cutoffDay = Math.min(cutoff, dayOf(todayISO()));
  const currentTotal = transactions
    .filter(item => monthKey(item.date) === month && dayOf(item.date) <= cutoffDay)
    .reduce((sum, item) => sum + item.amount, 0);
  const [year, monthNumber] = month.split('-').map(Number);
  const previousDate = new Date(year, monthNumber - 2, 1);
  const previousMonth = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`;
  const previousTotal = transactions
    .filter(item => monthKey(item.date) === previousMonth && dayOf(item.date) <= cutoffDay)
    .reduce((sum, item) => sum + item.amount, 0);
  if (previousTotal <= 0) return undefined;
  return {
    cutoffDay,
    currentMonth: month,
    currentTotal: Number(currentTotal.toFixed(2)),
    previousMonth,
    previousTotal: Number(previousTotal.toFixed(2)),
    delta: Number((currentTotal - previousTotal).toFixed(2)),
  };
};

export const buildLocalInsights = (transactions: Transaction[], budget: number): InsightResult => {
  const summaries = summarizeByMonth(transactions);
  const currentMonth = todayISO().slice(0, 7);
  const active = summaries.find(item => item.month === currentMonth) ?? summaries.at(-1);
  const complete = summaries.filter(item => item.isComplete);
  const completeCurrent = complete.at(-1);
  const completePrevious = complete.at(-2);
  const samePeriod = active ? samePeriodComparison(transactions, active.month, active.elapsedDays) : undefined;
  const insights: FinancialInsight[] = [];

  if (!active || active.count === 0) {
    return {
      source: 'local',
      enoughDataForModel: false,
      insights: [{ title: '数据还不够', body: '先记几笔账，我会开始观察预算、分类和完整月份变化。', tone: 'info' }],
    };
  }

  const budgetRatio = budget > 0 ? active.total / budget : 0;
  const recordDate = `${Number(active.lastDate.slice(5, 7))}月${Number(active.lastDate.slice(8, 10))}日`;
  insights.push({
    title: budgetRatio > 0.9 ? '预算接近上限' : budgetRatio > 0.65 ? '预算使用偏快' : '预算节奏正常',
    body: `${active.month === currentMonth ? `记录截至 ${recordDate}` : active.month}，支出 ${currency(active.total)}，占预算 ${(budgetRatio * 100).toFixed(0)}%；按记录区间 ${active.elapsedDays} 天日均约 ${currency(active.dailyAverage)}。`,
    tone: budgetRatio > 0.9 ? 'warn' : budgetRatio > 0.65 ? 'info' : 'success',
  });

  if (samePeriod) {
    const delta = samePeriod.delta;
    insights.push({
      title: '同日区间对比',
      body: `${samePeriod.currentMonth} 前 ${samePeriod.cutoffDay} 天支出 ${currency(samePeriod.currentTotal)}，比 ${samePeriod.previousMonth} 同期${delta >= 0 ? '多' : '少'} ${currency(Math.abs(delta))}。`,
      tone: delta > 0 ? 'warn' : 'success',
    });
  } else if (completeCurrent && completePrevious) {
    const delta = completeCurrent.total - completePrevious.total;
    insights.push({
      title: '完整月度对比',
      body: `${completeCurrent.month} 支出 ${currency(completeCurrent.total)}，比 ${completePrevious.month}${delta >= 0 ? '多' : '少'} ${currency(Math.abs(delta))}；未拿不完整月份直接相比。`,
      tone: delta > 0 ? 'warn' : 'success',
    });
  } else {
    insights.push({ title: '缺少完整月参照', body: '当前数据尚不足两个完整自然月，不生成容易误导的整月增减结论。', tone: 'info' });
  }

  const top = topCategory(active);
  if (top) {
    const ratio = active.total > 0 ? (top[1] / active.total) * 100 : 0;
    insights.push({
      title: '分类集中度',
      body: `${top[0]} 支出 ${currency(top[1])}，占当前统计期 ${ratio.toFixed(0)}%。`,
      tone: ratio > 45 ? 'warn' : 'info',
    });
  }

  const biggestRise = allCategoryDeltas(completeCurrent, completePrevious)[0];
  if (biggestRise && biggestRise.delta > 0 && completePrevious) {
    insights.push({
      title: '完整月分类变化',
      body: `${completeCurrent?.month} 的${biggestRise.category}比 ${completePrevious.month} 增加 ${currency(biggestRise.delta)}，可检查是否来自一次性支出。`,
      tone: 'warn',
    });
  }

  return {
    source: 'local',
    enoughDataForModel: complete.length >= 2 && active.count >= 8,
    insights: insights.slice(0, 4),
  };
};

const parseModelInsights = (value: unknown): FinancialInsight[] => {
  let parsed: { insights?: FinancialInsight[] };
  if (typeof value === 'string') {
    const cleaned = value.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1)) as { insights?: FinancialInsight[] };
  } else {
    parsed = (value ?? {}) as { insights?: FinancialInsight[] };
  }
  return (parsed.insights ?? [])
    .filter(item => item.title && item.body)
    .map(item => ({
      title: String(item.title).slice(0, 18),
      body: String(item.body).slice(0, 140),
      tone: (item.tone === 'warn' || item.tone === 'success' ? item.tone : 'info') as FinancialInsight['tone'],
    }))
    .slice(0, 5);
};

export const generateFinancialInsights = async (transactions: Transaction[], settings: AppSettings): Promise<InsightResult> => {
  const local = buildLocalInsights(transactions, settings.monthlyBudget);
  if (!local.enoughDataForModel) return local;

  const summaries = summarizeByMonth(transactions).slice(-6);
  const currentMonth = todayISO().slice(0, 7);
  const active = summaries.find(item => item.month === currentMonth) ?? summaries.at(-1);
  const complete = summaries.filter(item => item.isComplete);
  const completeCurrent = complete.at(-1);
  const completePrevious = complete.at(-2);
  const activeTransactions = active ? transactions.filter(item => monthKey(item.date) === active.month) : [];
  const coverage = tagCoverage(activeTransactions);
  const activeDays = active?.month === currentMonth ? active.elapsedDays : active ? daysInMonth(active.month) : 30;
  const remainingDays = active?.month === currentMonth ? Math.max(daysInMonth(currentMonth) - activeDays + 1, 1) : 1;
  const remainingBudget = Math.max(settings.monthlyBudget - (active?.total ?? 0), 0);
  const financialFacts = {
    activePeriod: active,
    activeMonthIsPartial: Boolean(active && !active.isComplete),
    samePeriodComparison: active ? samePeriodComparison(transactions, active.month, active.elapsedDays) : undefined,
    completeMonthComparison: completeCurrent && completePrevious ? { current: completeCurrent, previous: completePrevious } : undefined,
    budget: settings.monthlyBudget,
    budgetUsedPercent: active && settings.monthlyBudget > 0 ? Number(((active.total / settings.monthlyBudget) * 100).toFixed(1)) : 0,
    remainingBudget: Number(remainingBudget.toFixed(2)),
    remainingDailyTarget: Number((remainingBudget / remainingDays).toFixed(2)),
    categoryDeltas: allCategoryDeltas(completeCurrent, completePrevious).slice(0, 8),
    tagCoveragePercent: Number((coverage * 100).toFixed(1)),
    tagTotals: coverage >= 0.4 ? tagTotals(activeTransactions).slice(0, 6) : [],
  };
  const recentTransactions = transactions
    .slice()
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 30)
    .map(item => ({ date: item.date, amount: item.amount, category: item.category, description: item.description, tag: item.tag }));
  const requirements = [
    '每条洞察只陈述一个可核对结论，并引用明确金额、日期或分类基线',
    '禁止把当前不完整月份与完整月份直接比较；只用 samePeriodComparison 或 completeMonthComparison',
    '分类增减只能引用 financialFacts.categoryDeltas',
    'tagCoveragePercent 低于 40 时不得引用或推断任何标签结论',
    '不要分析商户，不推断消费动机、因果或价值判断',
    '最多给一个与数据直接对应的可执行建议',
  ];

  try {
    let modelResult: unknown;
    if (settings.aiMode === 'cloud') {
      if (!storage.getCloudSession()?.accessToken) return local;
      modelResult = await cloudApi.analyzeLedger(settings, { financialFacts, monthSummaries: summaries, recentTransactions, requirements, model: settings.model });
    } else {
      const useDevProxy = import.meta.env.DEV;
      if (!settings.apiKey.trim() && !useDevProxy) return local;
      const response = await fetch(useDevProxy ? '/__dev_mimo_chat' : `${settings.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(useDevProxy ? {} : { Authorization: `Bearer ${settings.apiKey}` }) },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0.2,
          max_completion_tokens: 2048,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: '你是私人记账分析助手。只允许引用输入 JSON 中明确存在的数据，不估算、不补全、不编造。必须返回 JSON：{"insights":[{"title":"短标题","body":"一句具体分析或建议","tone":"info|warn|success"}]}。' },
            { role: 'user', content: JSON.stringify({ financialFacts, monthSummaries: summaries, recentTransactions, requirements }) },
          ],
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      modelResult = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.message?.reasoning_content;
    }
    const insights = parseModelInsights(modelResult);
    return insights.length ? { source: 'model', enoughDataForModel: true, insights } : local;
  } catch (error) {
    console.warn('Financial insight generation failed, using local insights.', error);
    return local;
  }
};
