import React, { useEffect, useState } from 'react';
import { db, Transaction } from '../utils/db';
import { CATEGORY_EMOJIS, CATEGORY_COLORS } from '../utils/ai';

import { Sparkles, TrendingUp, TrendingDown, AlertCircle, Calendar, ShieldCheck } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budget, setBudget] = useState(3000);

  useEffect(() => {
    setTransactions(db.getTransactions());
    setBudget(db.getSettings().monthlyBudget);
  }, []);

  // --- 1. 时间过滤与基础统计数据计算 (以 2026-05-23 为基准今天) ---
  const todayStr = '2026-05-23';
  const getYearMonth = (dateStr: string) => dateStr.substring(0, 7); // "YYYY-MM"
  
  // 5月数据
  const mayTransactions = transactions.filter(t => getYearMonth(t.date) === '2026-05');
  const mayTotal = mayTransactions.reduce((sum, t) => sum + t.amount, 0);

  // 4月数据
  const aprilTransactions = transactions.filter(t => getYearMonth(t.date) === '2026-04');
  const aprilTotal = aprilTransactions.reduce((sum, t) => sum + t.amount, 0);

  // 预算百分比
  const budgetPercent = Math.min((mayTotal / budget) * 100, 100);

  // 日均消费 (5月已过去23天)
  const daysInMayPassed = 23;
  const mayDailyAverage = mayTotal / daysInMayPassed;

  // --- 2. 周度开销计算 (5月份细化到 W1 - W4) ---
  // W1: 5-01 ~ 5-02 (2天)
  // W2: 5-03 ~ 5-09 (7天)
  // W3: 5-10 ~ 5-16 (7天)
  // W4: 5-17 ~ 5-23 (7天)
  const getWeekNumber = (dateStr: string): number => {
    const day = parseInt(dateStr.split('-')[2]);
    if (day <= 2) return 1;
    if (day <= 9) return 2;
    if (day <= 16) return 3;
    return 4;
  };

  const weeklyData = [0, 0, 0, 0]; // W1, W2, W3, W4 对应的消费和
  mayTransactions.forEach(t => {
    const w = getWeekNumber(t.date);
    weeklyData[w - 1] += t.amount;
  });

  const maxWeeklySpent = Math.max(...weeklyData, 1);

  // --- 3. 跨月度消费趋势 (最近 4 个月：2月、3月、4月、5月) ---
  const getMonthTotal = (ym: string) => {
    return transactions
      .filter(t => getYearMonth(t.date) === ym)
      .reduce((sum, t) => sum + t.amount, 0);
  };
  
  const monthlyHistory = [
    { label: '2月', value: getMonthTotal('2026-02') },
    { label: '3月', value: getMonthTotal('2026-03') },
    { label: '4月', value: getMonthTotal('2026-04') },
    { label: '5月', value: mayTotal },
  ];
  const maxMonthlySpent = Math.max(...monthlyHistory.map(m => m.value), 1);

  // --- 4. 5月份消费分类统计排行 ---
  const categoryTotals: Record<string, number> = {};
  mayTransactions.forEach(t => {
    categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
  });

  const sortedCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  const maxCategorySpent = sortedCategories.length > 0 ? sortedCategories[0].value : 1;

  // --- 5. 环比与AI变化趋势洞察分析模型 (周环比与月度环比) ---
  // A. 周环比 (W4 vs W3)
  const w3Spent = weeklyData[2];
  const w4Spent = weeklyData[3];
  const weeklyDeltaPercent = w3Spent > 0 ? ((w4Spent - w3Spent) / w3Spent) * 100 : 0;

  // B. 月环比 (5月前23天对比4月前23天的归一化对比)
  // 4月前23天数据 (即日期 <= 2026-04-23)
  const aprilNormalizedTransactions = aprilTransactions.filter(t => {
    const day = parseInt(t.date.split('-')[2]);
    return day <= 23;
  });
  const aprilNormalizedTotal = aprilNormalizedTransactions.reduce((sum, t) => sum + t.amount, 0);
  const monthlyDeltaPercent = aprilNormalizedTotal > 0 ? ((mayTotal - aprilNormalizedTotal) / aprilNormalizedTotal) * 100 : 0;

  // C. 查找本月最主要的超支分类 (与上月对比增幅最大的分类)
  // 4月各分类统计
  const aprilCategoryTotals: Record<string, number> = {};
  aprilTransactions.forEach(t => {
    aprilCategoryTotals[t.category] = (aprilCategoryTotals[t.category] || 0) + t.amount;
  });
  
  let worstCategory = '';
  let worstIncrease = 0;
  Object.entries(categoryTotals).forEach(([cat, mayAmt]) => {
    const aprAmt = aprilCategoryTotals[cat] || 0;
    const diff = mayAmt - aprAmt;
    if (diff > worstIncrease && aprAmt > 0) {
      worstIncrease = diff;
      worstCategory = cat;
    }
  });

  return (
    <div className="w-full max-w-md mx-auto p-4 space-y-6 animate-slide-up pb-24">
      {/* 头部展示 */}
      <div className="flex justify-between items-start">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-dark-text flex items-center gap-1.5">
            记账仪表盘 <TrendingUp size={20} className="text-brand-purple" />
          </h1>
          <p className="text-xs text-dark-muted">财务数据大视界与 AI 环比趋势深度洞察</p>
        </div>
        <div className="text-[10px] text-brand-success bg-brand-success/10 px-2.5 py-1 rounded-full border border-brand-success/20 flex items-center gap-1">
          <ShieldCheck size={12} />
          数据完全本地安全
        </div>
      </div>

      {/* 1. 预算极光圆环与月统计卡片 */}
      <div className="glass-panel rounded-2xl p-5 relative overflow-hidden shadow-lg shadow-brand-purple/3">
        <div className="absolute right-[-40px] top-[-40px] w-32 h-32 rounded-full bg-brand-cyan/15 blur-3xl"></div>
        <div className="absolute left-[-40px] bottom-[-40px] w-32 h-32 rounded-full bg-brand-purple/15 blur-3xl"></div>

        <div className="flex flex-col items-center py-4 space-y-4">
          {/* 圆环 SVG 进度条 */}
          <div className="relative w-40 h-40 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              {/* 底环 */}
              <circle
                cx="50"
                cy="50"
                r="40"
                stroke="rgba(15, 23, 42, 0.05)"
                strokeWidth="7"
                fill="transparent"
              />
              {/* 进度环 */}
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
            
            {/* 中间文字 */}
            <div className="absolute text-center space-y-1">
              <span className="text-[10px] text-dark-muted font-medium tracking-widest uppercase">5月支出</span>
              <div className="text-2xl font-black text-dark-text font-mono tracking-tight">
                ￥{mayTotal.toFixed(0)}
              </div>
              <div className="text-[10px] text-dark-muted">
                预算 ￥{budget}
              </div>
            </div>
          </div>

          <div className="text-xs text-dark-text/80 font-medium">
            本月预算已消耗 <span className={`font-bold ${budgetPercent > 90 ? 'text-brand-rose' : budgetPercent > 70 ? 'text-brand-orange' : 'text-brand-purple'}`}>{budgetPercent.toFixed(0)}%</span>
          </div>
        </div>

        {/* 关键数据格子 */}
        <div className="grid grid-cols-2 gap-3 pt-4 border-t border-black/[0.05]">
          <div className="bg-black/[0.01] border border-black/[0.05] rounded-xl p-3 text-center space-y-0.5">
            <span className="text-[10px] text-dark-muted">日均开销 (前23天)</span>
            <p className="text-sm font-bold text-dark-text font-mono">￥{mayDailyAverage.toFixed(2)}</p>
          </div>
          <div className="bg-black/[0.01] border border-black/[0.05] rounded-xl p-3 text-center space-y-0.5">
            <span className="text-[10px] text-dark-muted">记账频次</span>
            <p className="text-sm font-bold text-dark-text font-mono">{mayTransactions.length} 笔流水</p>
          </div>
        </div>
      </div>

      {/* 2. AI 环比趋势变化深度洞察卡片 (根据计算数据智能组合) */}
      <div className="glass-panel rounded-2xl p-5 border border-brand-neon/20 shadow-md shadow-brand-neon/2 space-y-4">
        <div className="flex items-center gap-1.5 border-b border-black/[0.06] pb-2">
          <Sparkles size={16} className="text-brand-neon animate-pulse" />
          <h2 className="text-sm font-bold text-dark-text">AI 智能趋势洞察</h2>
        </div>

        <div className="space-y-3.5 text-xs text-dark-text leading-relaxed">
          {/* A. 周环比结论 */}
          <div className="flex gap-2">
            {weeklyDeltaPercent >= 0 ? (
              <TrendingUp size={16} className="text-brand-rose shrink-0" />
            ) : (
              <TrendingDown size={16} className="text-brand-success shrink-0" />
            )}
            <p>
              **本周开销环比对比**：本周支出为 ￥{w4Spent.toFixed(1)}，较上周的 ￥{w3Spent.toFixed(1)}{' '}
              <span className={weeklyDeltaPercent >= 0 ? 'text-brand-rose font-bold' : 'text-brand-success font-bold'}>
                {weeklyDeltaPercent >= 0 ? `上涨` : `下降`} {Math.abs(weeklyDeltaPercent).toFixed(1)}%
              </span>。
            </p>
          </div>

          {/* B. 月度环比结论 */}
          <div className="flex gap-2">
            {monthlyDeltaPercent >= 0 ? (
              <TrendingUp size={16} className="text-brand-rose shrink-0" />
            ) : (
              <TrendingDown size={16} className="text-brand-success shrink-0" />
            )}
            <p>
              **月度周期走势环比**：对比4月同期的前23天开支 (￥{aprilNormalizedTotal.toFixed(1)})，本月{' '}
              <span className={monthlyDeltaPercent >= 0 ? 'text-brand-rose font-bold' : 'text-brand-success font-bold'}>
                {monthlyDeltaPercent >= 0 ? '多支出' : '减少了'} {Math.abs(monthlyDeltaPercent).toFixed(1)}%
              </span>。当前财务扩张趋势为
              <span className={monthlyDeltaPercent >= 0 ? 'text-brand-rose font-bold' : 'text-brand-success font-bold'}>
                【{monthlyDeltaPercent >= 0 ? '超支预警' : '健康收缩'}】
              </span>。
            </p>
          </div>

          {/* C. 超支类别AI警告 */}
          {worstCategory && (
            <div className="flex gap-2 bg-brand-rose/10 p-2.5 rounded-xl border border-brand-rose/25 text-[11px] text-brand-orange">
              <AlertCircle size={15} className="shrink-0 text-brand-rose mt-0.5" />
              <p>
                ⚠️ **开支预警**：本月 **[{worstCategory}]** 分类消费相比上月同期涨幅最大（增支 ￥{worstIncrease.toFixed(0)}）。建议克制多余消费，避免继续在该类目中支出。
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 3. 5月份周度开支趋势柱状图 (高精 SVG 自定义绘制，100%稳定) */}
      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-dark-text flex items-center gap-1">
          <Calendar size={14} className="text-brand-purple" /> 5月周度消费趋势 (W1 - W4)
        </h2>
        
        <div className="h-36 flex items-end justify-between px-4 pt-4 border-b border-black/[0.05] relative">
          {/* 背景格线 */}
          <div className="absolute inset-x-0 top-1/3 border-t border-black/[0.02]" />
          <div className="absolute inset-x-0 top-2/3 border-t border-black/[0.02]" />

          {weeklyData.map((spent, idx) => {
            const hPercent = (spent / maxWeeklySpent) * 100;
            return (
              <div key={idx} className="flex flex-col items-center space-y-2 w-14 group z-10">
                {/* 悬浮数值 */}
                <span className="text-[10px] text-dark-muted opacity-80 group-hover:opacity-100 group-hover:text-brand-purple font-mono transition-opacity">
                  ￥{spent.toFixed(0)}
                </span>
                {/* 渐变柱子 */}
                <div 
                  className="w-8 rounded-t-lg bg-gradient-to-t from-brand-purple/50 to-brand-cyan/80 group-hover:to-brand-cyan shadow-md shadow-brand-purple/10 transition-all duration-500"
                  style={{ height: `${Math.max(hPercent, 6)}px` }}
                />
                {/* 下方标签 */}
                <span className="text-[10px] text-dark-muted font-medium pb-1">
                  第 {idx + 1} 周
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. 5月份消费分类统计比例排行 */}
      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-dark-text">5月分类消费开销排行榜</h2>
        
        <div className="space-y-3.5">
          {sortedCategories.length === 0 ? (
            <p className="text-xs text-dark-muted text-center py-4">本月暂无记账数据</p>
          ) : (
            sortedCategories.map(item => {
              const emoji = CATEGORY_EMOJIS[item.name] || '🪙';
              const colorClass = CATEGORY_COLORS[item.name] || 'from-gray-500/20 to-slate-500/20 text-gray-400 border-gray-500/30';
              const p = (item.value / maxCategorySpent) * 100;
              const ratio = (item.value / mayTotal) * 100;

              return (
                <div key={item.name} className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <div className="flex items-center gap-1.5">
                      <span>{emoji}</span>
                      <span className="text-dark-text">{item.name}</span>
                      <span className="text-[10px] text-dark-muted font-normal">占 {ratio.toFixed(0)}%</span>
                    </div>
                    <span className="font-mono text-dark-text">￥{item.value.toFixed(2)}</span>
                  </div>
                  {/* 自定义进度条 */}
                  <div className="w-full h-2 bg-black/[0.06] rounded-full overflow-hidden">
                    <div 
                      className={`h-full bg-gradient-to-r ${colorClass.split(' ')[0]} ${colorClass.split(' ')[1]} transition-all duration-500 rounded-full`}
                      style={{ width: `${Math.max(p, 4)}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 5. 跨月度消费历史分析 (最近 4 个月大趋势) */}
      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <h2 className="text-sm font-bold text-dark-text flex items-center gap-1">
          <TrendingUp size={14} className="text-brand-purple" /> 跨月消费支出总趋势 (近4个月)
        </h2>

        <div className="h-36 flex items-end justify-between px-6 pt-4 border-b border-black/[0.05] relative">
          <div className="absolute inset-x-0 top-1/2 border-t border-black/[0.02]" />

          {monthlyHistory.map((mon, idx) => {
            const hPercent = (mon.value / maxMonthlySpent) * 100;
            return (
              <div key={idx} className="flex flex-col items-center space-y-2 w-14 group z-10">
                <span className="text-[10px] text-dark-muted group-hover:text-brand-purple font-mono transition-colors">
                  ￥{mon.value.toFixed(0)}
                </span>
                <div 
                  className="w-6 rounded-t-lg bg-gradient-to-t from-brand-purple/70 to-brand-blue/30 group-hover:from-brand-purple group-hover:to-brand-cyan transition-all duration-500 shadow-md shadow-brand-purple/10"
                  style={{ height: `${Math.max(hPercent, 6)}px` }}
                />
                <span className="text-[10px] text-dark-muted font-medium pb-1">
                  {mon.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
