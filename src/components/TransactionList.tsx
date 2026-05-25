import { useMemo, useState } from 'react';
import { Calendar, CheckSquare, ChevronDown, ChevronUp, CreditCard, Search, ShoppingBag, Square, Tag, Trash2, X } from 'lucide-react';
import { getCategoryEmoji } from '../data/categories';
import { formatShortDate } from '../services/date';
import { storage } from '../services/storage';
import type { Transaction } from '../types';

interface TransactionListProps {
  onTransactionDeleted: () => void;
}

export function TransactionList({ onTransactionDeleted }: TransactionListProps) {
  const [list, setList] = useState(() => storage.getTransactions());
  const [settingsCategories] = useState(() => storage.getSettings().categories);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const categories = useMemo(() => {
    const historicalCategories = list.map(item => item.category);
    return Array.from(new Set([...settingsCategories, ...historicalCategories]));
  }, [list, settingsCategories]);

  const filteredList = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return list.filter(item => {
      const matchesCategory = selectedCategory === '全部' || item.category === selectedCategory;
      const matchesSearch =
        !keyword ||
        item.description.toLowerCase().includes(keyword) ||
        item.detail?.toLowerCase().includes(keyword) ||
        item.category.toLowerCase().includes(keyword) ||
        item.paymentMethod?.toLowerCase().includes(keyword) ||
        item.amount.toString().includes(keyword) ||
        item.tag?.toLowerCase().includes(keyword);
      return matchesCategory && matchesSearch;
    });
  }, [list, search, selectedCategory]);

  const grouped = useMemo(() => {
    return filteredList.reduce<Record<string, { items: Transaction[]; total: number }>>((acc, item) => {
      acc[item.date] ??= { items: [], total: 0 };
      acc[item.date].items.push(item);
      acc[item.date].total += item.amount;
      return acc;
    }, {});
  }, [filteredList]);

  const allVisibleSelected = filteredList.length > 0 && filteredList.every(item => selectedIds.includes(item.id));

  const toggleManaging = () => {
    setManaging(current => !current);
    setSelectedIds([]);
    setExpandedId(null);
  };

  const toggleSelected = (id: string) => {
    setSelectedIds(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]));
  };

  const toggleSelectVisible = () => {
    setSelectedIds(current => {
      const visibleIds = filteredList.map(item => item.id);
      if (visibleIds.length === 0) return current;
      if (visibleIds.every(id => current.includes(id))) {
        return current.filter(id => !visibleIds.includes(id));
      }
      return Array.from(new Set([...current, ...visibleIds]));
    });
  };

  const deleteItem = (id: string) => {
    if (!window.confirm('确定要删除这笔记录吗？')) return;
    storage.deleteTransaction(id);
    setList(storage.getTransactions());
    setExpandedId(current => (current === id ? null : current));
    onTransactionDeleted();
  };

  const deleteSelected = () => {
    if (!selectedIds.length) return;
    if (!window.confirm(`确定要删除选中的 ${selectedIds.length} 条记录吗？此操作不可撤销。`)) return;
    storage.deleteTransactions(selectedIds);
    setList(storage.getTransactions());
    setSelectedIds([]);
    setManaging(false);
    setExpandedId(null);
    onTransactionDeleted();
  };

  return (
    <div className="w-full max-w-md mx-auto p-4 space-y-5 animate-slide-up pb-24">
      <section className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              账单明细 <ShoppingBag size={18} className="text-brand-purple" />
            </h1>
            <p className="text-xs text-dark-muted">搜索、筛选并管理所有本地消费记录。</p>
          </div>
          <button
            type="button"
            onClick={toggleManaging}
            className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all active:scale-95 ${
              managing
                ? 'bg-black/[0.05] border-black/[0.08] text-dark-muted'
                : 'bg-brand-purple/10 border-brand-purple/20 text-brand-purple'
            }`}
          >
            {managing ? '完成' : '管理'}
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="relative glass-panel rounded-xl border border-black/[0.08] bg-white/50 flex items-center pr-3">
          <Search size={16} className="absolute left-3.5 text-dark-muted" />
          <input
            type="text"
            placeholder="搜索备注、分类、标签或金额"
            value={search}
            onChange={event => setSearch(event.target.value)}
            className="w-full text-xs bg-transparent rounded-xl pl-9 pr-8 py-3 focus:outline-none placeholder-dark-muted"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="p-1 rounded-full hover:bg-black/[0.05] text-dark-muted">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
          {['全部', ...categories].map(category => (
            <button
              key={category}
              type="button"
              onClick={() => setSelectedCategory(category)}
              className={`text-[11px] px-3.5 py-1.5 rounded-full shrink-0 border transition-all active:scale-95 ${
                selectedCategory === category
                  ? 'bg-gradient-to-r from-brand-purple to-brand-cyan text-white border-transparent font-bold shadow-md shadow-brand-purple/10'
                  : 'bg-black/[0.02] border-black/[0.05] text-dark-muted hover:bg-black/[0.05]'
              }`}
            >
              {category !== '全部' && <span className="mr-1">{getCategoryEmoji(category)}</span>}
              {category}
            </button>
          ))}
        </div>

        {managing && (
          <div className="glass-panel rounded-xl border border-black/[0.08] bg-white/50 p-2.5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={toggleSelectVisible}
              disabled={filteredList.length === 0}
              className="px-3 py-2 rounded-lg bg-black/[0.03] border border-black/[0.06] text-xs font-semibold text-dark-muted disabled:opacity-40 flex items-center gap-1.5"
            >
              {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
              {allVisibleSelected ? '取消全选' : '全选当前'}
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              disabled={selectedIds.length === 0}
              className="px-3 py-2 rounded-lg bg-brand-rose/10 border border-brand-rose/20 text-xs font-bold text-brand-rose disabled:opacity-40 flex items-center gap-1.5"
            >
              <Trash2 size={14} />
              删除 {selectedIds.length ? selectedIds.length : ''}
            </button>
          </div>
        )}
      </section>

      <section className="space-y-4">
        {Object.keys(grouped).length === 0 ? (
          <div className="glass-panel rounded-2xl p-10 text-center border border-black/[0.08] space-y-2">
            <Search size={30} className="mx-auto text-dark-muted" />
            <p className="text-sm font-semibold">没有匹配的账单</p>
            <p className="text-xs text-dark-muted">试着调整搜索词或分类筛选。</p>
          </div>
        ) : (
          Object.keys(grouped)
            .sort((a, b) => b.localeCompare(a))
            .map(date => (
              <div key={date} className="space-y-2">
                <div className="flex justify-between items-center px-1 text-xs text-dark-muted">
                  <span className="font-semibold text-dark-text/75 flex items-center gap-1">
                    <Calendar size={12} />
                    {formatShortDate(date)}
                  </span>
                  <span className="font-mono">日支出 ¥{grouped[date].total.toFixed(2)}</span>
                </div>
                <div className="glass-panel rounded-2xl overflow-hidden divide-y divide-black/[0.05]">
                  {grouped[date].items.map(item => {
                    const expanded = expandedId === item.id;
                    const selected = selectedIds.includes(item.id);
                    const title = transactionTitle(item);
                    return (
                      <article key={item.id}>
                        <button
                          type="button"
                          onClick={() => (managing ? toggleSelected(item.id) : setExpandedId(expanded ? null : item.id))}
                          className={`w-full p-3.5 flex items-center justify-between hover:bg-black/[0.02] transition-all text-left ${expanded ? 'bg-black/[0.01]' : ''}`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {managing && (
                              <span className={`shrink-0 ${selected ? 'text-brand-purple' : 'text-dark-muted'}`}>
                                {selected ? <CheckSquare size={18} /> : <Square size={18} />}
                              </span>
                            )}
                            <div className="w-10 h-10 rounded-xl bg-black/[0.04] flex items-center justify-center text-lg shadow-inner shrink-0">
                              {getCategoryEmoji(item.category)}
                            </div>
                            <div className="space-y-1 min-w-0 flex-1 pr-2">
                              <div className="flex items-center gap-1.5">
                                <h4 className="text-xs font-semibold truncate leading-tight flex-1">{title}</h4>
                                {item.tag && <span className="text-[9px] font-bold text-brand-purple bg-brand-purple/10 border border-brand-purple/20 px-1.5 py-0.5 rounded shrink-0">{item.tag}</span>}
                              </div>
                              <div className="flex items-center gap-1.5 text-[10px] text-dark-muted">
                                <span className="bg-black/[0.03] px-1.5 py-0.5 rounded border border-black/[0.05] shrink-0">{item.category}</span>
                                {item.paymentMethod && (
                                  <>
                                    <span>·</span>
                                    <span className="truncate">{item.paymentMethod}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0">
                            <span className="text-xs font-bold tracking-wide font-mono">-¥{item.amount.toFixed(2)}</span>
                            {!managing && <span className="text-dark-muted">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>}
                          </div>
                        </button>

                        <div className={`overflow-hidden transition-all duration-300 ${expanded ? 'max-h-96 border-t border-black/[0.05] bg-black/[0.01]' : 'max-h-0'}`}>
                          <div className="p-4 space-y-3.5">
                            <p className="text-xs leading-relaxed font-medium bg-dark-surface border border-black/[0.06] rounded-xl p-2.5 select-text">{item.detail || item.description}</p>
                            <div className="grid grid-cols-2 gap-2">
                              <Detail icon={<Tag size={14} className="text-brand-purple" />} label="分类" value={`${getCategoryEmoji(item.category)} ${item.category}`} />
                              {item.paymentMethod && <Detail icon={<CreditCard size={14} className="text-brand-cyan" />} label="支付方式" value={item.paymentMethod} />}
                              <Detail icon={<Calendar size={14} className="text-brand-blue" />} label="日期" value={item.date} />
                              <Detail icon={<Tag size={14} className="text-brand-neon" />} label="标签" value={item.tag ?? '无'} />
                            </div>
                            <div className="flex justify-end gap-2 pt-1 border-t border-black/[0.05]">
                              <button type="button" onClick={() => setExpandedId(null)} className="px-3.5 py-1.5 bg-black/[0.05] text-dark-muted rounded-lg text-[10px] font-semibold">
                                收起详情
                              </button>
                              <button type="button" onClick={() => deleteItem(item.id)} className="px-3.5 py-1.5 bg-brand-rose/10 text-brand-rose rounded-lg border border-brand-rose/20 text-[10px] font-bold flex items-center gap-1">
                                <Trash2 size={12} />
                                删除
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))
        )}
      </section>
    </div>
  );
}

function transactionTitle(item: Transaction) {
  const raw = item.description.replace(/\s+/g, ' ').trim();
  if (!raw || /根据|识别|归类|金额|原始描述|消费场景|拆单依据/.test(raw)) {
    return `${item.category}支出`;
  }
  const firstClause = raw.split(/[。；;，,]/)[0]?.trim() || raw;
  return firstClause.length > 14 ? `${firstClause.slice(0, 14)}...` : firstClause;
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-dark-surface border border-black/[0.06] rounded-xl p-2 flex items-center gap-2 min-w-0">
      <span className="shrink-0">{icon}</span>
      <div className="space-y-0.5 min-w-0">
        <span className="text-[9px] text-dark-muted block">{label}</span>
        <span className="text-[11px] font-semibold truncate block">{value}</span>
      </div>
    </div>
  );
}
