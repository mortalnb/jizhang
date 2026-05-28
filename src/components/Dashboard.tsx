import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calendar, ChartPie, Loader2, ShieldCheck, Sparkles, TrendingUp, X } from 'lucide-react';
import { CATEGORY_COLORS, getCategoryEmoji, getCategoryGradient } from '../data/categories';
import { formatShortDate, monthKey, todayISO } from '../services/date';
import { buildLocalInsights, generateFinancialInsights, type InsightResult } from '../services/financialInsights';
import { storage } from '../services/storage';
import type { Transaction } from '../types';

type DashboardView = 'overview' | 'category' | 'calendar';

const PIE_COLORS = ['#4f46e5', '#0284c7', '#059669', '#d97706', '#e11d48', '#7c3aed', '#0f766e', '#64748b'];

const categoryLedgerItems = (transactions: Transaction[]) =>
  transactions.flatMap(item =>
    item.subItems?.length
      ? item.subItems.map(subItem => ({
          amount: subItem.amount,
          category: subItem.category,
          tag: subItem.tag ?? item.tag,
        }))
      : [{ amount: item.amount, category: item.category, tag: item.tag }],
  );

export function Dashboard() {
  const [view, setView] = useState<DashboardView>('overview');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const transactions = useMemo(() => storage.getTransactions(), []);
  const settings = useMemo(() => storage.getSettings(), []);
  const budget = settings.monthlyBudget;
  const [insightResult, setInsightResult] = useState<InsightResult>(() => buildLocalInsights(transactions, budget));

  const currentMonth = todayISO().slice(0, 7);
  const monthTransactions = transactions.filter(item => monthKey(item.date) === currentMonth);
  const monthTotal = monthTransactions.reduce((sum, item) => sum + item.amount, 0);
  const budgetPercent = budget > 0 ? Math.min((monthTotal / budget) * 100, 100) : 0;
  const dayOfMonth = Number(todayISO().slice(8, 10));
  const dailyAverage = dayOfMonth > 0 ? monthTotal / dayOfMonth : 0;

  const weeklyData = [0, 0, 0, 0];
  monthTransactions.forEach(item => {
    const day = Number(item.date.slice(8, 10));
    const index = day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3;
    weeklyData[index] += item.amount;
  });
  const maxWeek = Math.max(...weeklyData, 1);

  const categoryRows = useMemo(() => {
    const ledgerItems = categoryLedgerItems(monthTransactions);
    return Object.entries(
      ledgerItems.reduce<Record<string, number>>((acc, item) => {
        acc[item.category] = (acc[item.category] ?? 0) + item.amount;
        return acc;
      }, {}),
    )
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [monthTransactions]);

  const tagRows = useMemo(() => {
    const ledgerItems = categoryLedgerItems(monthTransactions);
    return Object.entries(
      ledgerItems.reduce<Record<string, number>>((acc, item) => {
        if (!item.tag) return acc;
        acc[item.tag] = (acc[item.tag] ?? 0) + item.amount;
        return acc;
      }, {}),
    )
      .map(([tag, amount]) => ({ amount, tag }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  }, [monthTransactions]);

  const dailyGroups = useMemo(() => {
    return monthTransactions.reduce<Record<string, { total: number; items: Transaction[] }>>((acc, item) => {
      acc[item.date] ??= { total: 0, items: [] };
      acc[item.date].total += item.amount;
      acc[item.date].items.push(item);
      return acc;
    }, {});
  }, [monthTransactions]);

  const selectedDay = selectedDate ? dailyGroups[selectedDate] : null;
  const insightSignature = JSON.stringify({
    count: transactions.length,
    total: transactions.reduce((sum, item) => sum + item.amount, 0),
    last: transactions.map(item => `${item.id}:${item.amount}:${item.date}`).slice(0, 12),
    api: Boolean(settings.apiKey.trim()),
    model: settings.model,
    budget,
  });

  useEffect(() => {
    let active = true;
    void generateFinancialInsights(transactions, settings).then(result => {
      if (active) setInsightResult(result);
    });
    return () => {
      active = false;
    };
  }, [insightSignature, settings, transactions]);

  return (
    <div className="w-full max-w-md mx-auto px-4 space-y-5 animate-slide-up dashboard-bottom-space">
      <section className="flex justify-between items-start">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-1.5">
            记账仪表盘 <TrendingUp size={20} className="text-brand-purple" />
          </h1>
          <p className="text-xs text-dark-muted">本月资金状态、分类结构和每日花费。</p>
        </div>
        <div className="text-[10px] text-brand-success bg-brand-success/10 px-2.5 py-1 rounded-full border border-brand-success/20 flex items-center gap-1">
          <ShieldCheck size={12} />
          本地数据
        </div>
      </section>

      <section className="glass-panel rounded-2xl p-2 grid grid-cols-3 gap-1 sticky top-0 z-20">
        <Segment active={view === 'overview'} label="概览" onClick={() => setView('overview')} />
        <Segment active={view === 'category'} label="分类" onClick={() => setView('category')} />
        <Segment active={view === 'calendar'} label="日历" onClick={() => setView('calendar')} />
      </section>

      {view === 'overview' && (
        <>
          <BudgetCard
            budget={budget}
            budgetPercent={budgetPercent}
            dailyAverage={dailyAverage}
            monthTotal={monthTotal}
            transactionCount={monthTransactions.length}
          />
          <InsightCard result={insightResult} />
          <ChartCard title="本月周度趋势" icon={<Calendar size={14} className="text-brand-purple" />}>
            {weeklyData.map((amount, index) => (
              <Bar key={index} label={`W${index + 1}`} amount={amount} max={maxWeek} />
            ))}
          </ChartCard>
        </>
      )}

      {view === 'category' && <CategoryAnalysis categoryRows={categoryRows} monthTotal={monthTotal} tagRows={tagRows} />}

      {view === 'calendar' && (
        <CalendarOverview
          currentMonth={currentMonth}
          dailyGroups={dailyGroups}
          onSelectDate={setSelectedDate}
          selectedDate={selectedDate}
        />
      )}

      {selectedDate && selectedDay && (
        <DayDetailSheet date={selectedDate} items={selectedDay.items} total={selectedDay.total} onClose={() => setSelectedDate(null)} />
      )}
    </div>
  );
}

function Segment({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 rounded-xl text-xs font-bold transition-all ${
        active ? 'bg-white text-brand-purple shadow-sm border border-brand-purple/20' : 'text-dark-muted hover:text-dark-text'
      }`}
    >
      {label}
    </button>
  );
}

function BudgetCard({
  budget,
  budgetPercent,
  dailyAverage,
  monthTotal,
  transactionCount,
}: {
  budget: number;
  budgetPercent: number;
  dailyAverage: number;
  monthTotal: number;
  transactionCount: number;
}) {
  return (
    <section className="glass-panel rounded-2xl p-5 relative overflow-hidden shadow-lg shadow-brand-purple/3">
      <div className="absolute right-[-40px] top-[-40px] w-32 h-32 rounded-full bg-brand-cyan/15 blur-3xl" />
      <div className="absolute left-[-40px] bottom-[-40px] w-32 h-32 rounded-full bg-brand-purple/15 blur-3xl" />
      <div className="flex flex-col items-center py-4 space-y-4 relative">
        <div className="relative w-40 h-40 flex items-center justify-center">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" stroke="rgba(15, 23, 42, 0.05)" strokeWidth="7" fill="transparent" />
            <circle
              cx="50"
              cy="50"
              r="40"
              stroke={budgetPercent > 90 ? '#e11d48' : budgetPercent > 70 ? '#d97706' : '#4f46e5'}
              strokeWidth="7"
              fill="transparent"
              strokeDasharray={2 * Math.PI * 40}
              strokeDashoffset={2 * Math.PI * 40 * (1 - budgetPercent / 100)}
              strokeLinecap="round"
              className="transition-all duration-1000 ease-out"
            />
          </svg>
          <div className="absolute text-center space-y-1">
            <span className="text-[10px] text-dark-muted font-medium tracking-widest uppercase">本月支出</span>
            <div className="text-2xl font-black font-mono tracking-tight">¥{monthTotal.toFixed(0)}</div>
            <div className="text-[10px] text-dark-muted">预算 ¥{budget}</div>
          </div>
        </div>
        <div className="text-xs text-dark-text/80 font-medium">
          预算已使用 <span className="font-bold text-brand-purple">{budgetPercent.toFixed(0)}%</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-4 border-t border-black/[0.05]">
        <Metric label="日均开销" value={`¥${dailyAverage.toFixed(2)}`} />
        <Metric label="本月笔数" value={`${transactionCount} 笔`} />
      </div>
    </section>
  );
}

function InsightCard({ result }: { result: InsightResult }) {
  return (
    <section className="glass-panel rounded-2xl p-5 border border-brand-neon/20 shadow-md shadow-brand-neon/2 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold flex items-center gap-1.5">
          <Sparkles size={16} className="text-brand-neon" />
          智能洞察
        </h2>
        <span className="text-[10px] text-dark-muted bg-black/[0.03] border border-black/[0.05] rounded-full px-2 py-0.5 flex items-center gap-1">
          {result.source === 'model' ? <Sparkles size={10} className="text-brand-purple" /> : <Loader2 size={10} />}
          {result.source === 'model' ? '大模型分析' : result.enoughDataForModel ? '本地分析' : '数据积累中'}
        </span>
      </div>

      <div className="space-y-2.5">
        {result.insights.map(insight => (
          <div
            key={`${insight.title}-${insight.body}`}
            className={`rounded-2xl border p-3 text-xs leading-relaxed ${toneClass(insight.tone)}`}
          >
            <div className="flex gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-bold">{insight.title}</p>
                <p className="text-dark-text/80">{insight.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function toneClass(tone: 'info' | 'warn' | 'success') {
  if (tone === 'warn') return 'bg-brand-rose/8 border-brand-rose/20 text-brand-rose';
  if (tone === 'success') return 'bg-brand-success/8 border-brand-success/20 text-brand-success';
  return 'bg-brand-purple/8 border-brand-purple/20 text-brand-purple';
}

function CategoryAnalysis({
  categoryRows,
  monthTotal,
  tagRows,
}: {
  categoryRows: Array<{ category: string; amount: number }>;
  monthTotal: number;
  tagRows: Array<{ amount: number; tag: string }>;
}) {
  const topAmount = categoryRows[0]?.amount ?? 1;
  const pieGradient = buildPieGradient(categoryRows, monthTotal);

  return (
    <section className="glass-panel rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold flex items-center gap-1.5">
          <ChartPie size={15} className="text-brand-purple" />
          本月资金分类
        </h2>
        <span className="text-[10px] text-dark-muted font-mono">¥{monthTotal.toFixed(2)}</span>
      </div>

      {categoryRows.length === 0 ? (
        <p className="text-xs text-dark-muted text-center py-8">本月暂无记账数据</p>
      ) : (
        <>
          <div className="flex items-center justify-center py-2">
            <div className="relative w-48 h-48 rounded-full shadow-inner" style={{ background: pieGradient }}>
              <div className="absolute inset-8 rounded-full bg-white/90 backdrop-blur flex flex-col items-center justify-center text-center">
                <span className="text-[10px] text-dark-muted">总支出</span>
                <strong className="text-xl font-black font-mono">¥{monthTotal.toFixed(0)}</strong>
              </div>
            </div>
          </div>

          <div className="space-y-3.5">
            {categoryRows.map((row, index) => {
              const width = Math.max((row.amount / topAmount) * 100, 4);
              const ratio = monthTotal > 0 ? (row.amount / monthTotal) * 100 : 0;
              return (
                <div key={row.category} className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
                      <span>{getCategoryEmoji(row.category)}</span>
                      <span className="truncate">{row.category}</span>
                      <span className="text-[10px] text-dark-muted font-normal">{ratio.toFixed(0)}%</span>
                    </span>
                    <span className="font-mono">¥{row.amount.toFixed(2)}</span>
                  </div>
                  <div className="w-full h-2 bg-black/[0.06] rounded-full overflow-hidden">
                    <div className={`h-full bg-gradient-to-r ${getCategoryGradient(row.category)} rounded-full`} style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          {tagRows.length > 0 && (
            <div className="space-y-2 pt-3 border-t border-black/[0.05]">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-dark-text/80">账目标签</span>
                <span className="text-[10px] text-dark-muted">按商品/订单场景汇总</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {tagRows.map(row => (
                  <span key={row.tag} className="text-[10px] rounded-full border border-brand-purple/15 bg-brand-purple/8 text-brand-purple px-2.5 py-1 font-semibold">
                    {row.tag} · ¥{row.amount.toFixed(row.amount >= 100 ? 0 : 2)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function CalendarOverview({
  currentMonth,
  dailyGroups,
  onSelectDate,
  selectedDate,
}: {
  currentMonth: string;
  dailyGroups: Record<string, { total: number; items: Transaction[] }>;
  onSelectDate: (date: string) => void;
  selectedDate: string | null;
}) {
  const cells = buildMonthCells(currentMonth);
  const monthTotal = Object.values(dailyGroups).reduce((sum, day) => sum + day.total, 0);

  return (
    <section className="glass-panel rounded-2xl p-4 space-y-4">
      <div className="flex justify-between items-center px-1">
        <h2 className="text-sm font-bold flex items-center gap-1.5">
          <Calendar size={15} className="text-brand-purple" />
          每日花费
        </h2>
        <span className="text-[10px] text-dark-muted font-mono">
          {currentMonth} · ¥{monthTotal.toFixed(0)}
        </span>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-dark-muted font-bold">
        {['一', '二', '三', '四', '五', '六', '日'].map(day => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((cell, index) => {
          if (!cell) return <div key={`blank-${index}`} className="aspect-square" />;
          const date = `${currentMonth}-${String(cell).padStart(2, '0')}`;
          const total = dailyGroups[date]?.total ?? 0;
          const active = selectedDate === date;
          return (
            <button
              key={date}
              type="button"
              onClick={() => total > 0 && onSelectDate(date)}
              disabled={total === 0}
              className={`aspect-square rounded-xl border text-left p-1.5 transition-all ${
                active
                  ? 'bg-brand-purple text-white border-brand-purple shadow-md shadow-brand-purple/20'
                  : total > 0
                    ? 'bg-white/70 border-brand-purple/15 hover:border-brand-purple/40'
                    : 'bg-black/[0.015] border-black/[0.03] text-dark-muted/60'
              }`}
            >
              <span className="block text-[10px] font-bold leading-none">{cell}</span>
              {total > 0 && <span className="block mt-2 text-[10px] font-black font-mono leading-none">¥{formatCalendarAmount(total)}</span>}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-dark-muted px-1">日历中只显示当天总金额；点开有消费的日期可查看明细。</p>
    </section>
  );
}

function DayDetailSheet({ date, items, onClose, total }: { date: string; items: Transaction[]; onClose: () => void; total: number }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/25 backdrop-blur-[3px] px-5 safe-modal-y" onClick={onClose}>
      <section
        className="w-full max-w-sm rounded-3xl glass-panel-heavy border border-black/[0.06] p-5 space-y-4 animate-slide-up shadow-2xl shadow-slate-900/10"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-black">{formatShortDate(date)}</h3>
            <p className="text-xs text-dark-muted font-mono">
              合计 ¥{total.toFixed(2)} · {items.length} 笔
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl bg-black/[0.04] text-dark-muted hover:text-dark-text">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 max-h-[52dvh] overflow-y-auto no-scrollbar">
          {items.map(item => (
            <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/60 border border-black/[0.05] p-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-black/[0.04] flex items-center justify-center shrink-0">{getCategoryEmoji(item.category)}</div>
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">{item.description}</p>
                  <p className="text-[10px] text-dark-muted truncate">
                    {item.category} · {item.paymentMethod}
                  </p>
                </div>
              </div>
              <span className="text-xs font-black font-mono shrink-0">¥{item.amount.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/[0.01] border border-black/[0.05] rounded-xl p-3 text-center space-y-0.5">
      <span className="text-[10px] text-dark-muted">{label}</span>
      <p className="text-sm font-bold font-mono">{value}</p>
    </div>
  );
}

function ChartCard({ children, icon, title }: { children: React.ReactNode; icon: React.ReactNode; title: string }) {
  return (
    <section className="glass-panel rounded-2xl p-5 space-y-4">
      <h2 className="text-sm font-bold flex items-center gap-1">
        {icon} {title}
      </h2>
      <div className="h-36 flex items-end justify-between px-4 pt-4 border-b border-black/[0.05] relative">{children}</div>
    </section>
  );
}

function Bar({ amount, label, max }: { amount: number; label: string; max: number }) {
  const height = Math.max((amount / max) * 100, 6);
  return (
    <div className="flex flex-col items-center space-y-2 w-14 z-10">
      <span className="text-[10px] text-dark-muted font-mono">¥{amount.toFixed(0)}</span>
      <div className="w-8 rounded-t-lg bg-gradient-to-t from-brand-purple/60 to-brand-cyan/80 shadow-md shadow-brand-purple/10 transition-all duration-500" style={{ height }} />
      <span className="text-[10px] text-dark-muted font-medium pb-1">{label}</span>
    </div>
  );
}

function buildPieGradient(rows: Array<{ category: string; amount: number }>, total: number) {
  if (rows.length === 0 || total <= 0) return CATEGORY_COLORS.其他;

  let cursor = 0;
  const stops = rows.map((row, index) => {
    const start = cursor;
    const end = cursor + (row.amount / total) * 100;
    cursor = end;
    const color = PIE_COLORS[index % PIE_COLORS.length];
    return `${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

function buildMonthCells(month: string) {
  const [year, monthIndex] = month.split('-').map(Number);
  const first = new Date(year, monthIndex - 1, 1);
  const daysInMonth = new Date(year, monthIndex, 0).getDate();
  const mondayOffset = (first.getDay() + 6) % 7;
  return [...Array(mondayOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
}

function formatCalendarAmount(amount: number) {
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}k`;
  return amount.toFixed(0);
}
