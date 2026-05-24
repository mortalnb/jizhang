import { useRef, useState } from 'react';
import { Calendar, Check, CreditCard, DollarSign, Image, RefreshCw, Send, Sparkles, Tag, X } from 'lucide-react';
import { getCategoryEmoji } from '../data/categories';
import { aiParser } from '../services/aiParser';
import { parseBillText, recognizeBillImage, sourceOptions, type BillSource, type RecognizedBill } from '../services/billRecognition';
import { storage } from '../services/storage';
import type { ParsedTransaction, SplitItem } from '../types';

interface AIInputProps {
  onTransactionSaved: () => void;
  onNavigateToTransactions: () => void;
}

export function AIInput({ onNavigateToTransactions, onTransactionSaved }: AIInputProps) {
  const settings = storage.getSettings();
  const categories = settings.categories;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputText, setInputText] = useState('');
  const [parsedCard, setParsedCard] = useState<ParsedTransaction | null>(null);
  const [recognizedBill, setRecognizedBill] = useState<RecognizedBill | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const parse = async (text: string) => {
    if (!text.trim()) return;
    setLoading(true);
    setSuccess(false);
    setParsedCard(null);
    try {
      setRecognizedBill(null);
      setParsedCard(await aiParser.parse(text, settings));
    } finally {
      setLoading(false);
    }
  };

  const recognizeImage = async (file: File) => {
    setLoading(true);
    setSuccess(false);
    setParsedCard(null);
    setRecognizedBill(null);
    try {
      const bill = await recognizeBillImage(file, categories);
      setRecognizedBill(bill);
      setParsedCard(bill.result);
    } finally {
      setLoading(false);
    }
  };

  const switchBillSource = (source: BillSource) => {
    if (!recognizedBill) return;
    const result = parseBillText(recognizedBill.rawText, source, categories);
    const sourceLabel = sourceOptions.find(option => option.value === source)?.label ?? '普通账单';
    const next = {
      ...recognizedBill,
      source,
      sourceLabel,
      confidence: source === recognizedBill.source ? recognizedBill.confidence : 0.8,
      result,
    };
    setRecognizedBill(next);
    setParsedCard(result);
  };

  const save = () => {
    if (!parsedCard) return;
    if (parsedCard.splitItems?.length) {
      parsedCard.splitItems.forEach(item => {
        storage.saveTransaction({
          amount: item.amount,
          category: item.category,
          date: parsedCard.date,
          paymentMethod: parsedCard.paymentMethod,
          description: item.description,
          tag: item.tag ?? parsedCard.tag,
        });
      });
    } else {
      storage.saveTransaction({
        amount: parsedCard.amount,
        category: parsedCard.category,
        date: parsedCard.date,
        paymentMethod: parsedCard.paymentMethod,
        description: parsedCard.description,
        tag: parsedCard.tag,
      });
    }

    setInputText('');
    setParsedCard(null);
    setRecognizedBill(null);
    setSuccess(true);
    onTransactionSaved();
    window.setTimeout(() => {
      setSuccess(false);
      onNavigateToTransactions();
    }, 900);
  };

  const updateSplit = (index: number, patch: Partial<SplitItem>) => {
    if (!parsedCard?.splitItems) return;
    const splitItems = parsedCard.splitItems.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
    const amount = Number(splitItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
    setParsedCard({ ...parsedCard, amount, splitItems });
  };

  return (
    <div className="w-full max-w-md mx-auto p-4 space-y-6 animate-slide-up pb-24">
      <section className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          AI 智能记账 <Sparkles size={18} className="text-brand-purple animate-pulse" />
        </h1>
        <p className="text-xs text-dark-muted">输入一句话或导入账单截图，确认后保存到本地账本。</p>
      </section>

      {!parsedCard && !loading && !success && (
        <section className="glass-panel rounded-2xl p-4 space-y-4 shadow-lg shadow-brand-purple/5">
          <div className="relative ai-pulse-glow rounded-xl border border-black/[0.08] overflow-hidden bg-white/50 transition-all">
            <textarea
              rows={5}
              placeholder={'例如：昨晚在盒马买了面包和洗衣液花了 150，其中面包 90，洗衣液 60，支付宝支付'}
              value={inputText}
              onChange={event => setInputText(event.target.value)}
              className="w-full text-sm bg-transparent rounded-xl px-4 py-3.5 text-dark-text focus:outline-none placeholder-dark-muted resize-none leading-relaxed"
            />
            <button
              type="button"
              disabled={!inputText.trim()}
              onClick={() => parse(inputText)}
              className="absolute right-3 bottom-3 p-2 bg-gradient-to-r from-brand-purple to-brand-blue disabled:opacity-40 text-white rounded-lg shadow transition-all active:scale-95"
              aria-label="解析记账文本"
            >
              <Send size={14} />
            </button>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            className="hidden"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void recognizeImage(file);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-3.5 bg-black/[0.02] border border-black/[0.08] hover:border-brand-purple/40 hover:bg-brand-purple/[0.04] active:scale-95 font-medium rounded-xl flex items-center justify-center gap-2 transition-all shadow-inner"
          >
            <Image size={18} className="text-brand-purple" />
            导入盒马/淘宝截图并自动拆单
          </button>
        </section>
      )}

      {loading && (
        <section className="glass-panel rounded-2xl p-8 flex flex-col items-center justify-center space-y-4 animate-pulse border border-brand-purple/20">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-brand-purple to-brand-cyan flex items-center justify-center shadow-lg shadow-brand-purple/25">
            <Sparkles size={16} className="text-white animate-spin" />
          </div>
          <p className="text-sm font-semibold">正在识别截图来源、提取商品和金额...</p>
        </section>
      )}

      {success && (
        <section className="glass-panel rounded-2xl p-10 flex flex-col items-center justify-center space-y-4 border border-brand-success/20 shadow-md shadow-brand-success/2 animate-slide-up">
          <div className="w-14 h-14 rounded-full bg-brand-success/10 border border-brand-success/30 flex items-center justify-center shadow-lg shadow-brand-success/5">
            <Check size={32} className="text-brand-success" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="text-base font-bold">记账成功</h3>
            <p className="text-xs text-dark-muted">交易已保存到本地账本。</p>
          </div>
        </section>
      )}

      {parsedCard && !loading && (
        <section className="glass-panel rounded-2xl p-5 border border-brand-purple/20 space-y-5 animate-slide-up shadow-lg">
          <div className="flex justify-between items-center border-b border-black/[0.06] pb-2">
            <div className="space-y-0.5">
              <span className="text-sm font-bold text-brand-purple">解析结果确认</span>
              {recognizedBill && (
                <p className="text-[10px] text-dark-muted">
                  自动识别：{recognizedBill.sourceLabel} · 置信度 {(recognizedBill.confidence * 100).toFixed(0)}%
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setParsedCard(null);
                setRecognizedBill(null);
              }}
              className="p-1 rounded-lg hover:bg-black/[0.05] text-dark-muted"
            >
              <X size={16} />
            </button>
          </div>

          {recognizedBill && (
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-black/[0.02] border border-black/[0.05] p-1.5">
              {sourceOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => switchBillSource(option.value)}
                  className={`text-[11px] rounded-lg py-2 font-semibold transition-all flex items-center justify-center gap-1 ${
                    recognizedBill.source === option.value
                      ? 'bg-white text-brand-purple shadow-sm border border-brand-purple/20'
                      : 'text-dark-muted hover:text-dark-text'
                  }`}
                >
                  {recognizedBill.source === option.value && <RefreshCw size={11} />}
                  {option.label}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <FieldLabel icon={<DollarSign size={12} />} label="消费总计">
              <input
                type="number"
                step="0.01"
                disabled={Boolean(parsedCard.splitItems?.length)}
                value={parsedCard.amount}
                onChange={event => setParsedCard({ ...parsedCard, amount: Number(event.target.value) || 0 })}
                className="w-full text-xl font-extrabold bg-dark-surface border border-black/[0.08] rounded-xl px-3 py-2 text-brand-purple font-mono disabled:opacity-60"
              />
            </FieldLabel>
            <FieldLabel icon={<Calendar size={12} />} label="交易日期">
              <input
                type="date"
                value={parsedCard.date}
                onChange={event => setParsedCard({ ...parsedCard, date: event.target.value })}
                className="w-full text-xs bg-dark-surface border border-black/[0.08] rounded-xl px-3 py-2 text-dark-text focus:outline-none h-[42px]"
              />
            </FieldLabel>
          </div>

          {parsedCard.splitItems?.length ? (
            <div className="space-y-3">
              <p className="text-xs text-brand-neon font-bold">智能拆单明细</p>
              {parsedCard.splitItems.map((item, index) => (
                <div key={`${item.description}-${index}`} className="bg-black/[0.01] border border-black/[0.05] rounded-xl p-3 space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      step="0.01"
                      value={item.amount}
                      onChange={event => updateSplit(index, { amount: Number(event.target.value) || 0 })}
                      className="text-xs bg-dark-surface border border-black/[0.06] rounded-lg px-2.5 py-1.5 text-brand-cyan font-semibold font-mono"
                    />
                    <input
                      type="text"
                      value={item.description}
                      onChange={event => updateSplit(index, { description: event.target.value })}
                      className="text-xs bg-dark-surface border border-black/[0.06] rounded-lg px-2.5 py-1.5"
                    />
                  </div>
                  <CategoryPicker categories={categories} value={item.category} onChange={category => updateSplit(index, { category })} compact />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <CategoryPicker categories={categories} value={parsedCard.category} onChange={category => setParsedCard({ ...parsedCard, category })} />
              <div className="grid grid-cols-2 gap-3">
                <FieldLabel label="备注" icon={<Tag size={12} />}>
                  <input
                    type="text"
                    value={parsedCard.description}
                    onChange={event => setParsedCard({ ...parsedCard, description: event.target.value })}
                    className="w-full text-xs bg-dark-surface border border-black/[0.08] rounded-xl px-3 py-2 focus:outline-none"
                  />
                </FieldLabel>
                <FieldLabel label="支付方式" icon={<CreditCard size={12} />}>
                  <select
                    value={parsedCard.paymentMethod}
                    onChange={event => setParsedCard({ ...parsedCard, paymentMethod: event.target.value })}
                    className="w-full text-xs bg-dark-surface border border-black/[0.08] rounded-xl px-3 py-2 focus:outline-none h-[38px]"
                  >
                    <option>微信支付</option>
                    <option>支付宝</option>
                    <option>银行卡</option>
                    <option>现金</option>
                  </select>
                </FieldLabel>
              </div>
            </div>
          )}

          {parsedCard.tag && (
            <div className="inline-flex items-center gap-1.5 text-xs text-brand-purple bg-brand-purple/10 border border-brand-purple/20 rounded-xl px-3 py-2">
              <Tag size={12} />
              {parsedCard.tag}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setParsedCard(null);
                setRecognizedBill(null);
              }}
              className="flex-1 py-3 border border-black/[0.08] hover:bg-black/[0.05] text-dark-muted rounded-xl text-xs font-semibold"
            >
              取消
            </button>
            <button type="button" onClick={save} className="flex-1 py-3 bg-gradient-to-r from-brand-purple to-brand-blue text-white text-xs font-bold rounded-xl shadow-md shadow-brand-purple/20 flex items-center justify-center gap-1.5">
              <Check size={16} />
              确认入账
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function FieldLabel({ children, icon, label }: { children: React.ReactNode; icon: React.ReactNode; label: string }) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs text-dark-muted font-medium flex items-center gap-1">
        {icon} {label}
      </span>
      {children}
    </label>
  );
}

function CategoryPicker({
  categories,
  compact = false,
  onChange,
  value,
}: {
  categories: string[];
  compact?: boolean;
  onChange: (category: string) => void;
  value: string;
}) {
  return (
    <div className={compact ? 'flex gap-1.5 overflow-x-auto no-scrollbar py-0.5' : 'grid grid-cols-3 gap-2'}>
      {categories.map(category => (
        <button
          key={category}
          type="button"
          onClick={() => onChange(category)}
          className={`text-xs rounded-xl border transition-all active:scale-95 ${
            compact ? 'px-2.5 py-1 shrink-0' : 'py-2.5 flex flex-col items-center justify-center gap-1'
          } ${
            value === category
              ? 'bg-brand-purple/10 border-brand-purple/40 text-brand-purple font-bold shadow-md shadow-brand-purple/5'
              : 'bg-black/[0.02] border-black/[0.05] hover:bg-black/[0.05]'
          }`}
        >
          <span>{getCategoryEmoji(category)}</span>
          <span>{category}</span>
        </button>
      ))}
    </div>
  );
}
