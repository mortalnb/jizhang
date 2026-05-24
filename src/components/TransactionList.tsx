import React, { useState, useEffect } from 'react';
import { db, Transaction } from '../utils/db';
import { CATEGORY_EMOJIS, CATEGORY_COLORS } from '../utils/ai';
import { Search, Trash2, Calendar, Filter, ShoppingBag, X, ChevronDown, ChevronUp, CreditCard, Tag as TagIcon, Clock } from 'lucide-react';

interface TransactionListProps {
  onTransactionDeleted: () => void;
}

export const TransactionList: React.FC<TransactionListProps> = ({ onTransactionDeleted }) => {
  const [list, setList] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  
  // 新增：记录当前展开的账单项 ID，点击即可平滑展开/收起详情，解决长文本无法完全阅读的痛点
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setList(db.getTransactions());
    setCategories(db.getSettings().categories);
  }, []);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止冒泡，避免触发展开折叠
    if (window.confirm('确定要删除这笔记录吗？')) {
      db.deleteTransaction(id);
      setList(db.getTransactions());
      onTransactionDeleted();
      if (expandedId === id) setExpandedId(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  // 根据搜索和分类过滤数据
  const filteredList = list.filter(item => {
    const matchesSearch = 
      item.description.toLowerCase().includes(search.toLowerCase()) ||
      item.category.toLowerCase().includes(search.toLowerCase()) ||
      (item.tag && item.tag.toLowerCase().includes(search.toLowerCase())) ||
      item.amount.toString().includes(search);
      
    const matchesCategory = selectedCategory === '全部' || item.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  // 按日期将流水聚合分组
  const groupedTransactions: Record<string, { items: Transaction[]; dayTotal: number }> = {};
  filteredList.forEach(item => {
    const dateStr = item.date;
    if (!groupedTransactions[dateStr]) {
      groupedTransactions[dateStr] = { items: [], dayTotal: 0 };
    }
    groupedTransactions[dateStr].items.push(item);
    groupedTransactions[dateStr].dayTotal += item.amount;
  });

  // 按日期降序排列
  const sortedDates = Object.keys(groupedTransactions).sort((a, b) => b.localeCompare(a));

  // 日期格式化友好提示
  const formatGroupDate = (dateStr: string) => {
    if (dateStr === '2026-05-23') return '今天';
    if (dateStr === '2026-05-22') return '昨天';
    
    const [_, month, day] = dateStr.split('-');
    return `${parseInt(month)}月${parseInt(day)}日`;
  };

  return (
    <div className="w-full max-w-md mx-auto p-4 space-y-5 animate-slide-up pb-24">
      {/* 头部 */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-dark-text flex items-center gap-2">
          账单明细 <ShoppingBag size={18} className="text-brand-purple" />
        </h1>
        <p className="text-xs text-dark-muted">查看、筛选并管理您所有的历史消费记录</p>
      </div>

      {/* 搜索和筛选输入 */}
      <div className="space-y-3">
        <div className="relative glass-panel rounded-xl border border-black/[0.08] bg-white/50 focus-within:border-brand-purple/50 transition-all flex items-center pr-3">
          <Search size={16} className="absolute left-3.5 text-dark-muted" />
          <input
            type="text"
            placeholder="搜索备注、大类、标签(如#盒马周购)或金额..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full text-xs bg-transparent rounded-xl pl-9 pr-8 py-3 text-dark-text focus:outline-none placeholder-dark-muted"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="p-1 rounded-full hover:bg-black/[0.05] text-dark-muted hover:text-dark-text"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* 水平滑动分类标签筛选 */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
          {['全部', ...categories].map(cat => {
            const isSelected = selectedCategory === cat;
            const emoji = CATEGORY_EMOJIS[cat] || '🪙';
            
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`text-[11px] px-3.5 py-1.5 rounded-full shrink-0 border transition-all active:scale-95 cursor-pointer ${
                  isSelected
                    ? 'bg-gradient-to-r from-brand-purple to-brand-cyan text-white border-transparent font-bold shadow-md shadow-brand-purple/10'
                    : 'bg-black/[0.02] border-black/[0.05] text-dark-muted hover:bg-black/[0.05] hover:border-black/[0.08]'
                }`}
              >
                {cat !== '全部' && <span className="mr-1">{emoji}</span>}
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* 流水列表 */}
      <div className="space-y-4">
        {sortedDates.length === 0 ? (
          <div className="glass-panel rounded-2xl p-10 text-center border border-black/[0.08] space-y-2">
            <Filter size={32} className="mx-auto text-dark-muted animate-pulse" />
            <p className="text-sm font-semibold text-dark-text">未找到匹配账单</p>
            <p className="text-xs text-dark-muted">请调整筛选词或点击 AI 记账开始新增流水</p>
          </div>
        ) : (
          sortedDates.map(dateStr => {
            const { items, dayTotal } = groupedTransactions[dateStr];
            return (
              <div key={dateStr} className="space-y-2">
                {/* 聚合头部 */}
                <div className="flex justify-between items-center px-1 text-xs text-dark-muted">
                  <span className="font-semibold text-dark-text/75 flex items-center gap-1">
                    <Calendar size={12} />
                    {formatGroupDate(dateStr)}
                  </span>
                  <span className="font-mono">日支出 ￥{dayTotal.toFixed(2)}</span>
                </div>

                {/* 账单单条卡片 */}
                <div className="glass-panel rounded-2xl overflow-hidden divide-y divide-black/[0.05]">
                  {items.map(item => {
                    const isExpanded = expandedId === item.id;
                    const colorClass = CATEGORY_COLORS[item.category] || 'from-gray-500/20 to-slate-500/20 text-gray-400 border-gray-500/30';
                    
                    return (
                      <div key={item.id} className="transition-all duration-300">
                        {/* 1. 紧凑行视图 */}
                        <div
                          onClick={() => toggleExpand(item.id)}
                          className={`p-3.5 flex items-center justify-between hover:bg-black/[0.02] transition-all relative cursor-pointer ${
                            isExpanded ? 'bg-black/[0.01]' : ''
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {/* 左侧大Emoji */}
                            <div className="w-10 h-10 rounded-xl bg-black/[0.04] flex items-center justify-center text-lg shadow-inner shrink-0">
                              {CATEGORY_EMOJIS[item.category] || '🪙'}
                            </div>
                            
                            {/* 描述与账户（优化排版：单行备注，截断溢出，避开挤压） */}
                            <div className="space-y-1 min-w-0 flex-1 pr-2">
                              <div className="flex items-center gap-1.5">
                                <h4 className="text-xs font-semibold text-dark-text truncate leading-tight flex-1">
                                  {item.description}
                                </h4>
                                {item.tag && (
                                  <span className="text-[9px] font-bold text-brand-purple bg-brand-purple/10 border border-brand-purple/20 px-1.5 py-0.5 rounded shrink-0">
                                    {item.tag}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 text-[10px] text-dark-muted">
                                <span className="bg-black/[0.03] px-1.5 py-0.5 rounded border border-black/[0.05] shrink-0">
                                  {item.category}
                                </span>
                                <span>•</span>
                                <span className="truncate">{item.paymentMethod}</span>
                              </div>
                            </div>
                          </div>

                          {/* 右侧金额与展开箭头 */}
                          <div className="flex items-center gap-2.5 shrink-0">
                            <span className="text-xs font-bold text-dark-text tracking-wide font-mono">
                              -￥{item.amount.toFixed(2)}
                            </span>
                            <div className="text-dark-muted">
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </div>
                          </div>
                        </div>

                        {/* 2. 平滑折叠展开的“AI 极光账单明细抽屉” */}
                        <div
                          className={`overflow-hidden transition-all duration-300 ${
                            isExpanded ? 'max-h-60 border-t border-black/[0.05] bg-black/[0.01]' : 'max-h-0'
                          }`}
                        >
                          <div className="p-4 space-y-3.5">
                            {/* 完整备注事由 */}
                            <div className="space-y-1">
                              <span className="text-[10px] text-dark-muted font-medium flex items-center gap-1">说明详情</span>
                              <p className="text-xs text-dark-text leading-relaxed font-medium bg-dark-surface border border-black/[0.06] rounded-xl p-2.5 select-text">
                                {item.description}
                              </p>
                            </div>

                            {/* 核心账目要素属性标签组 */}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="bg-dark-surface border border-black/[0.06] rounded-xl p-2 flex items-center gap-2">
                                <TagIcon size={14} className="text-brand-purple shrink-0" />
                                <div className="space-y-0.5">
                                  <span className="text-[9px] text-dark-muted block">大类科目</span>
                                  <span className="text-[11px] text-dark-text font-semibold flex items-center gap-1">
                                    <span>{CATEGORY_EMOJIS[item.category] || '🪙'}</span>
                                    {item.category}
                                  </span>
                                </div>
                              </div>

                              <div className="bg-dark-surface border border-black/[0.06] rounded-xl p-2 flex items-center gap-2">
                                <CreditCard size={14} className="text-brand-cyan shrink-0" />
                                <div className="space-y-0.5">
                                  <span className="text-[9px] text-dark-muted block">支付方式</span>
                                  <span className="text-[11px] text-dark-text font-semibold">{item.paymentMethod}</span>
                                </div>
                              </div>

                              <div className="bg-dark-surface border border-black/[0.06] rounded-xl p-2 flex items-center gap-2">
                                <Clock size={14} className="text-brand-blue shrink-0" />
                                <div className="space-y-0.5">
                                  <span className="text-[9px] text-dark-muted block">消费日期</span>
                                  <span className="text-[11px] text-dark-text font-semibold font-mono">{item.date}</span>
                                </div>
                              </div>

                              {/* 专属标签栏 */}
                              <div className="bg-dark-surface border border-black/[0.06] rounded-xl p-2 flex items-center gap-2">
                                <TagIcon size={14} className="text-brand-neon shrink-0" />
                                <div className="space-y-0.5">
                                  <span className="text-[9px] text-dark-muted block">分类标签</span>
                                  <span className="text-[11px] text-brand-purple font-bold">{item.tag || '无标签'}</span>
                                </div>
                              </div>
                            </div>

                            {/* 交互按钮区（删除与收起） */}
                            <div className="flex justify-end gap-2 pt-1 border-t border-black/[0.05]">
                              <button
                                onClick={() => setExpandedId(null)}
                                className="px-3.5 py-1.5 bg-black/[0.05] text-dark-muted hover:text-dark-text rounded-lg text-[10px] font-semibold transition-all cursor-pointer"
                              >
                                收起详情
                              </button>
                              
                              <button
                                onClick={(e) => handleDelete(item.id, e)}
                                className="px-3.5 py-1.5 bg-brand-rose/10 hover:bg-brand-rose/25 text-brand-rose rounded-lg border border-brand-rose/20 text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer active:scale-95"
                              >
                                <Trash2 size={12} />
                                删除账目
                              </button>
                            </div>
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
