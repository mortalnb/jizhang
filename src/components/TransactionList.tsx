import { useMemo, useState } from 'react';
import { Calendar, CheckSquare, ChevronDown, ChevronUp, Pencil, Save, Search, ShoppingBag, Square, Tag, Trash2, X } from 'lucide-react';
import { getCategoryEmoji } from '../data/categories';
import { formatShortDate } from '../services/date';
import { categoryForFoldedParent, summarizeFoldedCategories } from '../services/foldedCategories';
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
  const [selectedMerchant, setSelectedMerchant] = useState('全部商户');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Transaction | null>(null);
  const [managing, setManaging] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const categories = useMemo(() => {
    const historicalCategories = list.flatMap(item => [item.category, ...(item.subItems?.map(subItem => subItem.category) ?? [])]);
    return Array.from(new Set([...settingsCategories, ...historicalCategories]));
  }, [list, settingsCategories]);

  const merchants = useMemo(
    () => Array.from(new Set(list.map(item => item.merchant).filter((merchant): merchant is string => Boolean(merchant)))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [list],
  );

  const filteredList = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return list.filter(item => {
      const matchesCategory = selectedCategory === '全部' || (item.subItems?.length ? item.subItems.some(subItem => subItem.category === selectedCategory) : item.category === selectedCategory);
      const matchesMerchant = selectedMerchant === '全部商户' || item.merchant === selectedMerchant;
      const matchesSearch =
        !keyword ||
        item.description.toLowerCase().includes(keyword) ||
        item.detail?.toLowerCase().includes(keyword) ||
        item.merchant?.toLowerCase().includes(keyword) ||
        item.orderId?.toLowerCase().includes(keyword) ||
        item.subItems?.some(
          subItem =>
            subItem.description.toLowerCase().includes(keyword) ||
            subItem.detail?.toLowerCase().includes(keyword) ||
            subItem.quantity?.toLowerCase().includes(keyword) ||
            subItem.category.toLowerCase().includes(keyword) ||
            subItem.amount.toString().includes(keyword),
        ) ||
        (!item.subItems?.length && item.category.toLowerCase().includes(keyword)) ||
        item.amount.toString().includes(keyword) ||
        item.tag?.toLowerCase().includes(keyword);
      return matchesCategory && matchesMerchant && matchesSearch;
    });
  }, [list, search, selectedCategory, selectedMerchant]);

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
    setEditingId(null);
    setEditDraft(null);
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

  const startEditing = (item: Transaction) => {
    setEditingId(item.id);
    setEditDraft({
      ...item,
      subItems: item.subItems?.map(subItem => ({ ...subItem })),
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const saveEditing = () => {
    if (!editDraft) return;
    storage.saveTransaction({
      ...editDraft,
      category: categoryForFoldedParent(editDraft.subItems, editDraft.category),
    });
    setList(storage.getTransactions());
    setEditingId(null);
    setEditDraft(null);
    onTransactionDeleted();
  };

  const updateSubItem = (index: number, patch: Partial<NonNullable<Transaction['subItems']>[number]>) => {
    if (!editDraft?.subItems) return;
    const subItems = editDraft.subItems.map((subItem, subItemIndex) => (subItemIndex === index ? { ...subItem, ...patch } : subItem));
    setEditDraft({
      ...editDraft,
      category: categoryForFoldedParent(subItems, editDraft.category),
      subItems,
    });
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
            placeholder="搜索备注、商品、商户、订单号或金额"
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
                  ? 'bg-brand-purple text-white border-transparent font-bold shadow-sm'
                  : 'bg-black/[0.02] border-black/[0.05] text-dark-muted hover:bg-black/[0.05]'
              }`}
            >
              {category !== '全部' && <span className="mr-1">{getCategoryEmoji(category)}</span>}
              {category}
            </button>
          ))}
        </div>

        {merchants.length > 0 && (
          <label className="glass-panel rounded-xl border border-black/[0.08] bg-white/50 px-3 py-2 flex items-center gap-2">
            <ShoppingBag size={14} className="text-brand-purple shrink-0" />
            <span className="text-[10px] text-dark-muted shrink-0">商户筛选</span>
            <select aria-label="商户筛选" value={selectedMerchant} onChange={event => setSelectedMerchant(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs font-semibold focus:outline-none">
              <option value="全部商户">全部商户</option>
              {merchants.map(merchant => <option key={merchant} value={merchant}>{merchant}</option>)}
            </select>
          </label>
        )}

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
                <div className="glass-panel rounded-2xl overflow-visible divide-y divide-black/[0.05]">
                  {grouped[date].items.map(item => {
                    const expanded = expandedId === item.id;
                    const editing = editingId === item.id && editDraft?.id === item.id;
                    const displayItem = editing ? editDraft : item;
                    const selected = selectedIds.includes(item.id);
                    const title = transactionTitle(item);
                    const categorySummary = summarizeFoldedCategories(displayItem.subItems);
                    const displayCategory = categorySummary.kind === 'mixed' ? '多分类' : categorySummary.category ?? displayItem.category;
                    return (
                      <article key={item.id}>
                        <button
                          type="button"
                          onClick={() => {
                            if (managing) {
                              toggleSelected(item.id);
                              return;
                            }
                            if (editing) return;
                            setExpandedId(expanded ? null : item.id);
                          }}
                          className={`w-full p-3.5 flex items-center justify-between hover:bg-black/[0.02] transition-all text-left ${expanded ? 'bg-black/[0.01]' : ''}`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {managing && (
                              <span className={`shrink-0 ${selected ? 'text-brand-purple' : 'text-dark-muted'}`}>
                                {selected ? <CheckSquare size={18} /> : <Square size={18} />}
                              </span>
                            )}
                            <div className="w-10 h-10 rounded-xl bg-black/[0.04] flex items-center justify-center text-lg shadow-inner shrink-0">
                              {categorySummary.kind === 'mixed' ? <ShoppingBag size={18} className="text-brand-purple" /> : getCategoryEmoji(displayCategory)}
                            </div>
                            <div className="space-y-1 min-w-0 flex-1 pr-2">
                              <div className="flex items-center gap-1.5">
                                <h4 className="text-xs font-semibold truncate leading-tight flex-1">{title}</h4>
                                {item.tag && <span className="text-[9px] font-bold text-brand-purple bg-brand-purple/10 border border-brand-purple/20 px-1.5 py-0.5 rounded shrink-0">{item.tag}</span>}
                                {item.recognition?.warnings?.length ? <span className="text-[9px] font-bold text-amber-600 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded shrink-0">需核对</span> : null}
                              </div>
                              <div className="flex items-center gap-1.5 text-[10px] text-dark-muted">
                                <span className="bg-black/[0.03] px-1.5 py-0.5 rounded border border-black/[0.05] shrink-0">{displayCategory}</span>
                                {item.merchant && <><span>·</span><span className="truncate">{item.merchant}</span></>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0">
                            <span className="text-xs font-bold tracking-wide font-mono">-¥{item.amount.toFixed(2)}</span>
                            {!managing && <span className="text-dark-muted">{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>}
                          </div>
                        </button>

                        <div className={`transition-all duration-300 ${expanded ? 'max-h-[70dvh] overflow-y-auto border-t border-black/[0.05] bg-black/[0.01]' : 'max-h-0 overflow-hidden'}`}>
                          <div className="p-4 space-y-3.5">
                            <p className="text-xs leading-relaxed font-medium bg-dark-surface border border-black/[0.06] rounded-xl p-2.5 select-text">{displayItem.detail || displayItem.description}</p>
                            {item.recognition && (
                              <div className="rounded-xl border border-brand-purple/15 bg-brand-purple/8 p-2.5 space-y-1">
                                <div className="text-[10px] font-bold text-brand-purple flex items-center justify-between">
                                  <span>{item.recognition.source ?? '识别来源'}</span>
                                  {item.recognition.itemCount ? <span>{item.recognition.itemCount} 项</span> : null}
                                </div>
                                {item.recognition.warnings?.length ? (
                                  <p className="text-[10px] text-amber-700 leading-relaxed">{item.recognition.warnings.join('；')}</p>
                                ) : (
                                  <p className="text-[10px] text-dark-muted">基础金额校验通过，仍建议核对商品名称和分类。</p>
                                )}
                              </div>
                            )}
                            {displayItem.subItems?.length ? (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-[10px] text-dark-muted px-1">
                                  <span>商品明细</span>
                                  <span>{displayItem.subItems.length} 项</span>
                                </div>
                                <div className="rounded-xl border border-black/[0.06] bg-dark-surface divide-y divide-black/[0.05] overflow-visible">
                                  {displayItem.subItems.map((subItem, index) => (
                                    <div key={`${subItem.description}-${index}`} className={`p-2.5 gap-3 ${editing ? 'space-y-2' : 'flex items-start justify-between'}`}>
                                      <div className="min-w-0 flex-1 space-y-1">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <span className="text-sm shrink-0">{getCategoryEmoji(subItem.category)}</span>
                                          <span className="text-xs font-semibold truncate">{subItem.description}</span>
                                        </div>
                                        {editing ? (
                                          <div>
                                            <EditSelect
                                              ariaLabel={`${subItem.description}分类`}
                                              categories={categories}
                                              value={subItem.category}
                                              onChange={category => updateSubItem(index, { category })}
                                            />
                                          </div>
                                        ) : (
                                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-dark-muted">
                                            <span className="bg-black/[0.03] border border-black/[0.05] rounded px-1.5 py-0.5">{subItem.category}</span>
                                            {subItem.quantity && <span>{subItem.quantity}</span>}
                                          </div>
                                        )}
                                      </div>
                                      <span className="text-xs font-bold font-mono shrink-0">¥{subItem.amount.toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {editing ? (
                              <div className="grid grid-cols-2 gap-2">
                                {displayItem.subItems?.length ? (
                                  <EditField label="分类归属">
                                    <span className="text-[11px] font-semibold text-brand-purple block truncate">
                                      {categorySummary.kind === 'mixed' ? `按 ${categorySummary.categories.length} 类明细统计` : `${getCategoryEmoji(displayCategory)} ${displayCategory}`}
                                    </span>
                                  </EditField>
                                ) : (
                                  <EditField label="分类">
                                    <EditSelect
                                      ariaLabel="账单分类"
                                      categories={categories}
                                      value={displayItem.category}
                                      onChange={category => setEditDraft({ ...displayItem, category })}
                                    />
                                  </EditField>
                                )}
                                <EditField label="日期">
                                  <EditDatePicker
                                    ariaLabel="账单日期"
                                    value={displayItem.date}
                                    onChange={date => setEditDraft({ ...displayItem, date })}
                                  />
                                </EditField>
                                <EditField label="标签">
                                  <EditInput
                                    ariaLabel="账单标签"
                                    placeholder="标签（可选）"
                                    value={displayItem.tag ?? ''}
                                    onChange={tag => setEditDraft({ ...displayItem, tag: tag.trim() || undefined })}
                                  />
                                </EditField>
                                <EditField label="商户">
                                  <EditInput ariaLabel="账单商户" placeholder="商户（可选）" value={displayItem.merchant ?? ''} onChange={merchant => setEditDraft({ ...displayItem, merchant: merchant.trim() || undefined })} />
                                </EditField>
                                <EditField label="订单号">
                                  <EditInput ariaLabel="账单订单号" placeholder="订单号（可选）" value={displayItem.orderId ?? ''} onChange={orderId => setEditDraft({ ...displayItem, orderId: orderId.trim() || undefined })} />
                                </EditField>
                              </div>
                            ) : (
                              <div className="grid grid-cols-2 gap-2">
                                <Detail icon={<Tag size={14} className="text-brand-purple" />} label="分类归属" value={categorySummary.kind === 'mixed' ? `按 ${categorySummary.categories.length} 类商品明细` : `${getCategoryEmoji(displayCategory)} ${displayCategory}`} />
                                <Detail icon={<Calendar size={14} className="text-brand-blue" />} label="日期" value={item.date} />
                                <Detail icon={<Tag size={14} className="text-brand-purple" />} label="场景标签" value={item.tag ?? '无'} />
                                {item.merchant && <Detail icon={<ShoppingBag size={14} className="text-brand-cyan" />} label="商户" value={item.merchant} />}
                                {item.orderId && <Detail icon={<Tag size={14} className="text-brand-blue" />} label="订单号" value={item.orderId} />}
                              </div>
                            )}
                            <div className="flex justify-end gap-2 pt-1 border-t border-black/[0.05]">
                              {editing ? (
                                <>
                                  <button type="button" onClick={cancelEditing} className="px-3.5 py-1.5 bg-black/[0.05] text-dark-muted rounded-lg text-[10px] font-semibold">
                                    取消
                                  </button>
                                  <button type="button" onClick={saveEditing} className="px-3.5 py-1.5 bg-brand-purple/10 text-brand-purple rounded-lg border border-brand-purple/20 text-[10px] font-bold flex items-center gap-1">
                                    <Save size={12} />
                                    保存修改
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button type="button" onClick={() => startEditing(item)} className="px-3.5 py-1.5 bg-brand-purple/10 text-brand-purple rounded-lg border border-brand-purple/20 text-[10px] font-bold flex items-center gap-1">
                                    <Pencil size={12} />
                                    编辑
                                  </button>
                                  <button type="button" onClick={() => setExpandedId(null)} className="px-3.5 py-1.5 bg-black/[0.05] text-dark-muted rounded-lg text-[10px] font-semibold">
                                    收起详情
                                  </button>
                                  <button type="button" onClick={() => deleteItem(item.id)} className="px-3.5 py-1.5 bg-brand-rose/10 text-brand-rose rounded-lg border border-brand-rose/20 text-[10px] font-bold flex items-center gap-1">
                                    <Trash2 size={12} />
                                    删除
                                  </button>
                                </>
                              )}
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
    const summary = summarizeFoldedCategories(item.subItems);
    return summary.kind === 'mixed' ? '综合采购' : `${summary.category ?? item.category}支出`;
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

function EditField({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="bg-dark-surface/80 border border-black/[0.06] rounded-xl p-2.5 space-y-1.5 min-w-0 transition-colors focus-within:border-brand-purple/35 focus-within:bg-white">
      <span className="text-[9px] text-dark-muted block font-medium">{label}</span>
      {children}
    </label>
  );
}

function EditInput({
  ariaLabel,
  onChange,
  placeholder,
  type = 'text',
  value,
}: {
  ariaLabel: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  return (
    <input
      aria-label={ariaLabel}
      type={type === 'date' ? 'text' : type}
      inputMode={type === 'date' ? 'numeric' : undefined}
      placeholder={placeholder ?? (type === 'date' ? 'YYYY-MM-DD' : undefined)}
      value={value}
      onChange={event => onChange(event.target.value)}
      className="w-full min-w-0 h-8 text-[11px] bg-white border border-black/[0.06] rounded-lg px-2.5 text-dark-text shadow-inner shadow-black/[0.015] focus:outline-none focus:border-brand-purple/45 focus:ring-2 focus:ring-brand-purple/10"
    />
  );
}

function EditDatePicker({ ariaLabel, onChange, value }: { ariaLabel: string; onChange: (value: string) => void; value: string }) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => value.slice(0, 7));
  const today = new Date().toISOString().slice(0, 10);
  const days = calendarDays(visibleMonth);
  const monthLabel = `${Number(visibleMonth.slice(5, 7))}月 ${visibleMonth.slice(0, 4)}`;

  const shiftMonth = (offset: number) => {
    const [year, month] = visibleMonth.split('-').map(Number);
    const next = new Date(year, month - 1 + offset, 1);
    setVisibleMonth(toISODate(next).slice(0, 7));
  };

  return (
    <div
      className="relative min-w-0"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen(state => !state)}
        className="w-full min-w-0 h-8 text-[11px] bg-white border border-black/[0.06] rounded-lg px-2.5 text-dark-text shadow-inner shadow-black/[0.015] focus:outline-none focus:border-brand-purple/45 focus:ring-2 focus:ring-brand-purple/10 flex items-center gap-1.5 text-left"
      >
        <Calendar size={13} className="text-brand-blue shrink-0" />
        <span className="truncate font-medium">{value}</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.375rem)] z-50 rounded-xl border border-black/[0.08] bg-white shadow-xl shadow-slate-900/10 p-2.5">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => shiftMonth(-1)} className="w-7 h-7 rounded-lg bg-dark-surface text-dark-muted hover:text-dark-text">
              ‹
            </button>
            <span className="text-[11px] font-bold text-dark-text">{monthLabel}</span>
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => shiftMonth(1)} className="w-7 h-7 rounded-lg bg-dark-surface text-dark-muted hover:text-dark-text">
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[9px] text-dark-muted mb-1">
            {['一', '二', '三', '四', '五', '六', '日'].map(day => (
              <span key={day} className="py-1">
                {day}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map(day => {
              const active = day.date === value;
              const isToday = day.date === today;
              return (
                <button
                  key={day.date}
                  type="button"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => {
                    onChange(day.date);
                    setOpen(false);
                  }}
                  className={`h-7 rounded-lg text-[10px] transition-colors ${
                    active
                      ? 'bg-brand-purple text-white font-bold'
                      : day.inMonth
                        ? 'text-dark-text hover:bg-dark-surface'
                        : 'text-dark-muted/45 hover:bg-dark-surface/70'
                  } ${isToday && !active ? 'border border-brand-purple/25 text-brand-purple' : ''}`}
                >
                  {Number(day.date.slice(8, 10))}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onMouseDown={event => event.preventDefault()}
            onClick={() => {
              onChange(today);
              setVisibleMonth(today.slice(0, 7));
              setOpen(false);
            }}
            className="mt-2 w-full h-8 rounded-lg bg-dark-surface text-[11px] font-bold text-brand-purple hover:bg-brand-purple/10"
          >
            选择今天
          </button>
        </div>
      )}
    </div>
  );
}

function EditSelect({
  ariaLabel,
  categories,
  onChange,
  value,
}: {
  ariaLabel: string;
  categories: string[];
  onChange: (value: string) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative min-w-0"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="w-full min-w-0 h-8 text-[11px] bg-white border border-black/[0.06] rounded-lg pl-2.5 pr-7 text-dark-text shadow-inner shadow-black/[0.015] focus:outline-none focus:border-brand-purple/45 focus:ring-2 focus:ring-brand-purple/10 flex items-center gap-1.5 text-left"
      >
        <span className="shrink-0 text-xs">{getCategoryEmoji(value)}</span>
        <span className="truncate font-medium">{value}</span>
      </button>
      <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-dark-muted" />
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.375rem)] z-50 rounded-xl border border-black/[0.08] bg-white shadow-xl shadow-slate-900/10 overflow-hidden">
          <div className="max-h-56 overflow-y-auto no-scrollbar p-1">
            {categories.map(category => {
              const active = category === value;
              return (
                <button
                  key={category}
                  type="button"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => {
                    onChange(category);
                    setOpen(false);
                  }}
                  className={`w-full h-8 rounded-lg px-2.5 text-[11px] flex items-center gap-2 text-left transition-colors ${
                    active ? 'bg-brand-purple/10 text-brand-purple font-bold' : 'text-dark-text hover:bg-dark-surface'
                  }`}
                >
                  <span className="w-4 text-center shrink-0">{getCategoryEmoji(category)}</span>
                  <span className="truncate">{category}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function calendarDays(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const start = new Date(first);
  const weekday = first.getDay() === 0 ? 7 : first.getDay();
  start.setDate(first.getDate() - weekday + 1);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date: toISODate(date),
      inMonth: date.getMonth() === month - 1,
    };
  });
}

function toISODate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
