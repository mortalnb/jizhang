import { useEffect, useRef, useState } from 'react';
import { Calendar, Check, DollarSign, Image, Layers, Loader2, Mic, ReceiptText, RefreshCw, Send, Square, Tag, Trash2, UnfoldVertical, X } from 'lucide-react';
import { getCategoryEmoji } from '../data/categories';
import { aiParser } from '../services/aiParser';
import { parseBillText, recognizeBillImage, sourceOptions, type BillSource, type RecognizedBill } from '../services/billRecognition';
import { categoryForFoldedParent, summarizeFoldedCategories } from '../services/foldedCategories';
import { storage } from '../services/storage';
import { MAX_VOICE_SECONDS, startVoiceRecorder, transcribeVoice, type ActiveVoiceRecorder } from '../services/voiceInput';
import type { ParsedBatch, ParsedTransaction, SplitItem } from '../types';

interface AIInputProps {
  onTransactionSaved: () => void;
  onNavigateToTransactions: () => void;
}

const itemTotal = (transaction: ParsedTransaction) => Number((transaction.splitItems ?? []).reduce((sum, item) => sum + item.amount, 0).toFixed(2));

const mergedTransaction = (batch: ParsedBatch, label = '合并消费'): ParsedTransaction => {
  const first = batch.transactions[0];
  const splitItems = batch.transactions.flatMap(transaction =>
    transaction.splitItems?.length
      ? transaction.splitItems
      : [{
          amount: transaction.amount,
          category: transaction.category,
          description: transaction.description,
          detail: transaction.detail,
        }],
  );
  return {
    amount: Number(batch.transactions.reduce((sum, transaction) => sum + transaction.amount, 0).toFixed(2)),
    category: categoryForFoldedParent(splitItems, first?.category ?? '其他'),
    description: label,
    detail: `手动合并 ${batch.transactions.length} 笔消费；合并后使用第一笔日期。`,
    date: first?.date ?? new Date().toISOString().slice(0, 10),
    tag: first?.tag,
    grouping: 'folded',
    splitItems,
  };
};

const expandedTransactions = (batch: ParsedBatch): ParsedTransaction[] =>
  batch.transactions.flatMap((transaction): ParsedTransaction[] =>
    transaction.splitItems?.length
      ? transaction.splitItems.map(item => ({
          amount: item.amount,
          category: item.category,
          description: item.description,
          detail: item.detail ?? transaction.detail,
          date: transaction.date,
          tag: transaction.tag,
          merchant: transaction.merchant,
          grouping: 'separate' as const,
        }))
      : [{ ...transaction, grouping: 'separate' as const }],
  );

export function AIInput({ onNavigateToTransactions, onTransactionSaved }: AIInputProps) {
  const settings = storage.getSettings();
  const categories = settings.categories;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<ActiveVoiceRecorder | null>(null);
  const voiceTimerRef = useRef<number | undefined>(undefined);
  const voiceLimitRef = useRef<number | undefined>(undefined);
  const saveTransitionRef = useRef<number | undefined>(undefined);
  const savingRef = useRef(false);
  const [inputText, setInputText] = useState('');
  const [parsedBatch, setParsedBatch] = useState<ParsedBatch | null>(null);
  const [recognizedBill, setRecognizedBill] = useState<RecognizedBill | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<'image' | 'text' | 'voice'>('text');
  const [recording, setRecording] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [requestRoute, setRequestRoute] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    window.clearInterval(voiceTimerRef.current);
    window.clearTimeout(voiceLimitRef.current);
    window.clearTimeout(saveTransitionRef.current);
    void recorderRef.current?.cancel();
  }, []);

  const normalizeCategory = (category: string, text = '') => {
    if (categories.includes(category)) return category;
    const source = `${category} ${text}`;
    if (/薯片|饼干|糖果|巧克力|坚果|零食/.test(source)) return categories.includes('零食') ? '零食' : categories[0];
    if (/苹果|香蕉|橙子|葡萄|草莓|水果|果切/.test(source)) return categories.includes('水果') ? '水果' : categories[0];
    if (/大模型|模型token|token|API充值|ChatGPT|Claude|Gemini|AI订阅|AI服务/i.test(source)) return categories.includes('AI服务') ? 'AI服务' : categories[0];
    if (/生鲜|食品|果蔬|蔬菜|饭|餐|肉|蛋|鱼|虾|面包|水饺|馒头/.test(source)) return categories.includes('餐费') ? '餐费' : categories[0];
    if (/饮料|咖啡|奶茶|牛奶|酸奶|发酵乳|水|啤酒|茶|果汁/.test(source)) return categories.includes('饮料') ? '饮料' : categories[0];
    if (/日用|清洁|洗|纸巾|牙膏|湿巾/.test(source)) return categories.includes('日用') ? '日用' : categories[0];
    if (/鞋|衣|裤|服饰/.test(source)) return categories.includes('服饰') ? '服饰' : categories[0];
    if (/数码|手机|电脑|耳机|充电/.test(source)) return categories.includes('数码') ? '数码' : categories[0];
    if (/水费|电费|燃气|物业|话费|网费|缴费|交费/.test(source)) return categories.includes('交费') ? '交费' : categories[0];
    if (/维修|修理|保养|安装/.test(source)) return categories.includes('维修') ? '维修' : categories[0];
    return categories.includes('其他') ? '其他' : categories[categories.length - 1];
  };

  const normalizeBatchCategories = (batch: ParsedBatch): ParsedBatch => ({
    ...batch,
    transactions: batch.transactions.map(transaction => {
      const splitItems = transaction.splitItems?.map(item => ({
        ...item,
        category: normalizeCategory(item.category, `${item.description} ${item.detail ?? ''}`),
      }));
      const fallbackCategory = normalizeCategory(transaction.category, `${transaction.description} ${transaction.detail ?? ''}`);
      return {
        ...transaction,
        category: categoryForFoldedParent(splitItems, fallbackCategory),
        splitItems,
      };
    }),
  });

  const parse = async (text: string) => {
    if (!text.trim()) return;
    savingRef.current = false;
    setSaving(false);
    setLoadingMode('text');
    setLoading(true);
    setSuccess(false);
    setParsedBatch(null);
    setError(null);
    try {
      setRecognizedBill(null);
      const result = normalizeBatchCategories(await aiParser.parse(text, settings));
      setParsedBatch(result);
      setRequestRoute(settings.aiMode === 'cloud' ? '云端 MiMo 批量解析' : import.meta.env.DEV ? '开发代理 · MiMo 批量解析' : settings.apiKey.trim() ? '自填 Key · MiMo 批量解析' : '本地规则');
    } catch (caught) {
      setError(caught instanceof Error ? `解析失败：${caught.message}` : '解析失败，请重试或切换智能服务。');
    } finally {
      setLoading(false);
    }
  };

  const recognizeImage = async (file: File) => {
    savingRef.current = false;
    setSaving(false);
    setLoadingMode('image');
    setLoading(true);
    setSuccess(false);
    setParsedBatch(null);
    setRecognizedBill(null);
    setError(null);
    try {
      const bill = await recognizeBillImage(file, categories, settings);
      const batch = normalizeBatchCategories(bill.batch);
      const normalizedBill = { ...bill, batch, result: batch.transactions[0] };
      setRecognizedBill(normalizedBill);
      setParsedBatch(batch);
      setRequestRoute(settings.aiMode === 'cloud' ? '云端 MiMo 视觉解析' : bill.mode === 'vision' ? '自填 Key · MiMo 视觉解析' : '本地 OCR/规则');
    } catch (caught) {
      setError(caught instanceof Error ? `截图识别失败：${caught.message}` : '截图识别失败，请重试或切换智能服务。');
    } finally {
      setLoading(false);
    }
  };

  const stopRecording = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    window.clearInterval(voiceTimerRef.current);
    window.clearTimeout(voiceLimitRef.current);
    setRecording(false);
    setLoadingMode('voice');
    setLoading(true);
    setError(null);
    try {
      const recordingResult = await recorder.stop();
      const transcript = await transcribeVoice(recordingResult, settings);
      setInputText(transcript);
      setRequestRoute(settings.aiMode === 'cloud' ? '云端 mimo-v2.5-asr' : import.meta.env.DEV ? '开发代理 · mimo-v2.5-asr' : '自填 Key · mimo-v2.5-asr');
    } catch (caught) {
      setError(caught instanceof Error ? `语音转写失败：${caught.message}` : '语音转写失败，请重试。');
    } finally {
      setLoading(false);
      setVoiceSeconds(0);
    }
  };

  const startRecording = async () => {
    savingRef.current = false;
    setSaving(false);
    setError(null);
    setSuccess(false);
    try {
      recorderRef.current = await startVoiceRecorder();
      setVoiceSeconds(0);
      setRecording(true);
      voiceTimerRef.current = window.setInterval(() => setVoiceSeconds(seconds => Math.min(MAX_VOICE_SECONDS, seconds + 1)), 1000);
      voiceLimitRef.current = window.setTimeout(() => void stopRecording(), MAX_VOICE_SECONDS * 1000);
    } catch (caught) {
      setError(caught instanceof Error ? `无法开始录音：${caught.message}` : '无法开始录音，请检查麦克风权限。');
    }
  };

  const switchBillSource = (source: BillSource) => {
    if (!recognizedBill) return;
    let batch: ParsedBatch;
    if (recognizedBill.mode === 'vision') {
      batch = parsedBatch ?? recognizedBill.batch;
      if ((source === 'hema' || source === 'walmart') && batch.transactions.length > 1) {
        batch = { transactions: [mergedTransaction(batch, source === 'hema' ? '盒马鲜生订单' : '沃尔玛超市采购')] };
      }
    } else {
      const result = parseBillText(recognizedBill.rawText, source, categories);
      batch = { transactions: [result] };
    }
    batch = normalizeBatchCategories(batch);
    const sourceLabel = sourceOptions.find(option => option.value === source)?.label ?? '普通账单';
    setRecognizedBill({ ...recognizedBill, source, sourceLabel, confidence: source === recognizedBill.source ? recognizedBill.confidence : 0.8, result: batch.transactions[0], batch });
    setParsedBatch(batch);
  };

  const updateTransaction = (index: number, patch: Partial<ParsedTransaction>) => {
    if (!parsedBatch) return;
    setParsedBatch({ ...parsedBatch, transactions: parsedBatch.transactions.map((transaction, itemIndex) => itemIndex === index ? { ...transaction, ...patch } : transaction) });
  };

  const updateSplit = (transactionIndex: number, splitIndex: number, patch: Partial<SplitItem>) => {
    const transaction = parsedBatch?.transactions[transactionIndex];
    if (!parsedBatch || !transaction?.splitItems) return;
    const splitItems = transaction.splitItems.map((item, itemIndex) => itemIndex === splitIndex ? { ...item, ...patch } : item);
    updateTransaction(transactionIndex, { category: categoryForFoldedParent(splitItems, transaction.category), splitItems });
  };

  const save = () => {
    if (savingRef.current || !parsedBatch?.transactions.length) return;
    const invalid = parsedBatch.transactions.find(transaction => transaction.amount <= 0 || !/^20\d{2}-\d{2}-\d{2}$/.test(transaction.date));
    if (invalid) {
      setError('保存前请确认每一笔的金额大于 0，日期格式正确。');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    let savedSuccessfully = false;
    try {
      const recognitionSource = recognizedBill
        ? recognizedBill.mode === 'vision' ? '视觉模型识别' : recognizedBill.mode === 'local-ocr' ? '本地 OCR 回退' : '样本规则识别'
        : undefined;
      const saved = storage.saveTransactions(parsedBatch.transactions.map(transaction => ({
        amount: transaction.amount,
        category: transaction.category,
        date: transaction.date,
        description: transaction.description,
        detail: transaction.detail,
        recognition: recognitionSource ? {
          itemCount: transaction.splitItems?.length,
          source: recognitionSource,
          warnings: parsedBatch.warnings,
        } : undefined,
        subItems: transaction.splitItems,
        tag: transaction.tag,
        merchant: transaction.merchant,
        orderId: transaction.orderId,
      })));
      setSavedCount(saved.length);
      setSuccess(true);
      onTransactionSaved();
      savedSuccessfully = true;
      // Keep the disabled confirmation button in place until the pointer's
      // double-click window closes, so a second click cannot hit the image
      // upload button after the view changes.
      saveTransitionRef.current = window.setTimeout(() => {
        setInputText('');
        setParsedBatch(null);
        setRecognizedBill(null);
        setRequestRoute(null);
        setSaving(false);
        window.requestAnimationFrame(() => textareaRef.current?.focus());
      }, 350);
    } catch (caught) {
      savingRef.current = false;
      setError(caught instanceof Error ? `入账失败：${caught.message}` : '入账失败，请重试。');
    } finally {
      if (!savedSuccessfully) setSaving(false);
    }
  };

  const hasFoldedItems = Boolean(parsedBatch?.transactions.some(transaction => transaction.splitItems?.length));

  return (
    <div className="w-full max-w-md mx-auto p-4 space-y-6 animate-slide-up pb-24">
      <section className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">记一笔 <ReceiptText size={18} className="text-brand-purple" /></h1>
        <p className="text-xs text-dark-muted">文字、截图或应用内录音均先解析成一笔或多笔，确认后再原子写入本地账本。</p>
      </section>

      {error && <div className="rounded-xl border border-brand-rose/30 bg-brand-rose/5 px-3 py-2 text-xs text-brand-rose">{error}</div>}
      {requestRoute && <div className="rounded-xl border border-brand-purple/20 bg-brand-purple/5 px-3 py-2 text-xs text-brand-purple">本次请求路径：{requestRoute}</div>}

      {success && (
        <section role="status" aria-live="polite" className="glass-panel rounded-2xl p-4 border border-brand-success/20 animate-slide-up space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 shrink-0 rounded-full bg-brand-success/10 border border-brand-success/30 flex items-center justify-center"><Check size={22} className="text-brand-success" /></div>
            <div><h3 className="text-sm font-bold">已安全写入 {savedCount} 笔</h3><p className="text-[10px] text-dark-muted mt-0.5">输入框已清空，可继续记账；云同步开启时会在后台上传新快照。</p></div>
          </div>
          <button type="button" onClick={onNavigateToTransactions} className="w-full py-2.5 rounded-xl border border-brand-success/25 text-brand-success text-xs font-bold">查看刚入账明细</button>
        </section>
      )}

      {!parsedBatch && !loading && (
        <section className="glass-panel rounded-2xl p-4 space-y-4">
          <div className={`relative ai-pulse-glow rounded-xl border overflow-hidden bg-white/50 transition-all ${recording ? 'border-brand-rose/40' : 'border-black/[0.08]'}`}>
            <textarea
              ref={textareaRef}
              rows={6}
              placeholder={'例如：8月1日买咖啡18元；8月2日坐地铁3元。也可以点击麦克风直接说。'}
              value={inputText}
              onChange={event => {
                setInputText(event.target.value);
                setSuccess(false);
                savingRef.current = false;
              }}
              disabled={recording}
              className="w-full text-sm bg-transparent rounded-xl px-4 py-3.5 pb-14 text-dark-text focus:outline-none placeholder-dark-muted resize-none leading-relaxed disabled:opacity-60"
            />
            <div className="absolute left-3 right-3 bottom-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => recording ? void stopRecording() : void startRecording()}
                className={`h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 ${recording ? 'bg-brand-rose text-white' : 'bg-dark-surface border border-black/[0.08] text-brand-purple'}`}
              >
                {recording ? <Square size={13} /> : <Mic size={15} />}
                {recording ? `停止录音 ${voiceSeconds}s` : '应用内语音'}
              </button>
              <button type="button" disabled={!inputText.trim() || recording || saving} onClick={() => void parse(inputText)} className="h-9 px-3 bg-brand-purple disabled:opacity-40 text-white rounded-lg shadow-sm transition-all active:scale-95 flex items-center gap-1.5 text-xs font-bold" aria-label="解析记账文本">
                <Send size={14} />解析
              </button>
            </div>
          </div>
          {recording && <p className="text-[10px] text-brand-rose">正在采集麦克风音频，最长 {MAX_VOICE_SECONDS} 秒；停止后由 mimo-v2.5-asr 转成可编辑文字，不会自动入账。</p>}

          <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void recognizeImage(file); event.target.value = ''; }} />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full py-3.5 bg-dark-surface border border-black/[0.06] hover:border-brand-purple/35 hover:bg-brand-purple/[0.04] active:scale-95 font-medium rounded-xl flex items-center justify-center gap-2 transition-all">
            <Image size={18} className="text-brand-purple" />导入超市/淘宝截图并按账单性质整理
          </button>
        </section>
      )}

      {loading && (
        <section className="glass-panel rounded-2xl p-8 flex flex-col items-center justify-center space-y-4 border border-brand-purple/15">
          <div className="w-10 h-10 rounded-full bg-brand-purple/10 border border-brand-purple/20 flex items-center justify-center"><Loader2 size={17} className="text-brand-purple animate-spin" /></div>
          <p className="text-sm font-semibold">{loadingMode === 'image' ? '正在识别账单性质、订单和商品...' : loadingMode === 'voice' ? 'mimo-v2.5-asr 正在转写录音...' : '正在按日期和付款行为拆分消费...'}</p>
        </section>
      )}

      {parsedBatch && !loading && (
        <section className="space-y-4 animate-slide-up">
          <div className="glass-panel rounded-2xl p-4 border border-brand-purple/15 space-y-3">
            <div className="flex justify-between items-start">
              <div><span className="text-sm font-bold text-brand-purple">解析结果：{parsedBatch.transactions.length} 笔独立消费</span><p className="text-[10px] text-dark-muted mt-1">不同日期保留为不同卡片；商品明细留在同一结账卡片内折叠。</p></div>
              <button type="button" onClick={() => { setParsedBatch(null); setRecognizedBill(null); }} className="p-1 rounded-lg hover:bg-black/[0.05] text-dark-muted"><X size={16} /></button>
            </div>
            {recognizedBill && <p className="text-[10px] text-dark-muted">自动识别：{recognizedBill.sourceLabel} · {recognizedBill.mode === 'vision' ? '视觉模型' : '本地 OCR/规则'} · 置信度 {(recognizedBill.confidence * 100).toFixed(0)}%</p>}
            {parsedBatch.warnings?.length ? <p className="text-[10px] text-amber-700">需核对：{parsedBatch.warnings.join('；')}</p> : null}
            {recognizedBill && (
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-black/[0.02] border border-black/[0.05] p-1.5">
                {sourceOptions.map(option => <button key={option.value} type="button" onClick={() => switchBillSource(option.value)} className={`text-[10px] rounded-lg py-2 font-semibold flex items-center justify-center gap-1 ${recognizedBill.source === option.value ? 'bg-white text-brand-purple shadow-sm border border-brand-purple/20' : 'text-dark-muted'}`}>{recognizedBill.source === option.value && <RefreshCw size={10} />}{option.label}</button>)}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {parsedBatch.transactions.length > 1 && <button type="button" onClick={() => { const dates = new Set(parsedBatch.transactions.map(item => item.date)); if (dates.size > 1 && !window.confirm('这些消费日期不同。合并后会使用第一笔日期，仍要继续吗？')) return; setParsedBatch({ transactions: [mergedTransaction(parsedBatch)] }); }} className="py-2 rounded-xl border border-black/[0.08] text-[10px] font-bold text-brand-purple flex items-center justify-center gap-1"><Layers size={13} />手动合并为一笔</button>}
              {hasFoldedItems && <button type="button" onClick={() => setParsedBatch({ transactions: expandedTransactions(parsedBatch) })} className="py-2 rounded-xl border border-black/[0.08] text-[10px] font-bold text-brand-purple flex items-center justify-center gap-1"><UnfoldVertical size={13} />商品展开为多笔</button>}
            </div>
          </div>

          {parsedBatch.transactions.map((transaction, transactionIndex) => {
            const detailTotal = itemTotal(transaction);
            const totalMismatch = detailTotal > 0 && Math.abs(detailTotal - transaction.amount) > 0.05;
            const categorySummary = summarizeFoldedCategories(transaction.splitItems);
            return (
              <article key={`${transaction.date}-${transactionIndex}`} className="glass-panel rounded-2xl p-4 border border-black/[0.07] space-y-4">
                <div className="flex items-center justify-between"><span className="text-xs font-bold">第 {transactionIndex + 1} 笔 · {transaction.grouping === 'folded' || transaction.splitItems?.length ? '折叠账单' : '独立消费'}</span>{parsedBatch.transactions.length > 1 && <button type="button" onClick={() => setParsedBatch({ ...parsedBatch, transactions: parsedBatch.transactions.filter((_, index) => index !== transactionIndex) })} className="p-1.5 text-brand-rose"><Trash2 size={14} /></button>}</div>
                <input value={transaction.description} onChange={event => updateTransaction(transactionIndex, { description: event.target.value })} className="w-full text-sm font-bold bg-dark-surface border border-black/[0.08] rounded-xl px-3 py-2" aria-label={`第${transactionIndex + 1}笔描述`} />
                <div className="grid grid-cols-2 gap-3">
                  <FieldLabel icon={<DollarSign size={12} />} label="实际支出"><input type="number" step="0.01" value={transaction.amount} onChange={event => updateTransaction(transactionIndex, { amount: Number(event.target.value) || 0 })} className="w-full text-lg font-extrabold bg-dark-surface border border-black/[0.08] rounded-xl px-3 py-2 text-brand-purple font-mono" /></FieldLabel>
                  <FieldLabel icon={<Calendar size={12} />} label="交易日期"><input type="date" value={transaction.date} onChange={event => updateTransaction(transactionIndex, { date: event.target.value })} className="w-full text-xs bg-dark-surface border border-black/[0.08] rounded-xl px-3 py-2 h-[42px]" /></FieldLabel>
                </div>
                {transaction.splitItems?.length ? (
                  <div className="space-y-1">
                    <span className="text-xs text-dark-muted font-medium flex items-center gap-1"><Tag size={12} />分类归属</span>
                    <div className="min-w-0 rounded-xl border border-brand-purple/20 bg-brand-purple/[0.05] px-3 py-2.5 flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-lg bg-white border border-brand-purple/15 text-brand-purple flex items-center justify-center shrink-0"><Layers size={15} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-dark-text truncate">
                          {categorySummary.kind === 'mixed' ? '综合采购' : `${getCategoryEmoji(categorySummary.category ?? transaction.category)} ${categorySummary.category ?? transaction.category}`}
                        </p>
                        <p className="text-[10px] text-dark-muted mt-0.5">
                          {categorySummary.kind === 'mixed' ? `按 ${categorySummary.categories.length} 类商品明细统计` : '父账单分类自动跟随商品明细'}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1"><span className="text-xs text-dark-muted font-medium flex items-center gap-1"><Tag size={12} />分类</span><CategoryPicker categories={categories} value={transaction.category} onChange={category => updateTransaction(transactionIndex, { category })} /></div>
                )}

                {transaction.splitItems?.length ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between"><p className="text-xs text-brand-purple font-bold">商品明细（默认折叠保存）</p><span className={`text-[10px] ${totalMismatch ? 'text-amber-700' : 'text-dark-muted'}`}>明细 ¥{detailTotal.toFixed(2)}{totalMismatch ? ` / 实付 ¥${transaction.amount.toFixed(2)}` : ''}</span></div>
                    {transaction.splitItems.map((item, splitIndex) => (
                      <div key={`${item.description}-${splitIndex}`} className="min-w-0 overflow-hidden bg-black/[0.01] border border-black/[0.05] rounded-xl p-3 space-y-2.5">
                        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
                          <label className="min-w-0">
                            <span className="sr-only">第{splitIndex + 1}项金额</span>
                            <input aria-label={`第${splitIndex + 1}项金额`} type="number" step="0.01" value={item.amount} onChange={event => updateSplit(transactionIndex, splitIndex, { amount: Number(event.target.value) || 0 })} className="w-full min-w-0 h-9 text-xs bg-dark-surface border border-black/[0.06] rounded-lg px-2.5 text-brand-cyan font-semibold font-mono" />
                          </label>
                          <label className="min-w-0">
                            <span className="sr-only">第{splitIndex + 1}项商品名称</span>
                            <input aria-label={`第${splitIndex + 1}项商品名称`} title={item.description} type="text" value={item.description} onChange={event => updateSplit(transactionIndex, splitIndex, { description: event.target.value })} className="w-full min-w-0 h-9 text-xs bg-dark-surface border border-black/[0.06] rounded-lg px-2.5 text-ellipsis" />
                          </label>
                        </div>
                        <div className={`grid gap-2 ${item.quantity ? 'grid-cols-[minmax(0,1fr)_minmax(7.5rem,0.8fr)]' : 'grid-cols-1'}`}>
                          {item.quantity && (
                            <label className="min-w-0 space-y-1">
                              <span className="text-[9px] text-dark-muted block px-0.5">数量</span>
                              <input aria-label={`第${splitIndex + 1}项商品数量`} type="text" value={item.quantity} onChange={event => updateSplit(transactionIndex, splitIndex, { quantity: event.target.value })} className="w-full min-w-0 h-9 text-[10px] bg-dark-surface border border-black/[0.06] rounded-lg px-2.5" />
                            </label>
                          )}
                          <label className="min-w-0 space-y-1">
                            <span className="text-[9px] text-dark-muted block px-0.5">明细分类</span>
                            <select aria-label={`第${splitIndex + 1}项商品分类`} value={item.category} onChange={event => updateSplit(transactionIndex, splitIndex, { category: event.target.value })} className="w-full min-w-0 h-9 text-[10px] bg-dark-surface border border-black/[0.06] rounded-lg px-2.5 text-dark-text focus:outline-none focus:border-brand-purple/35">
                              {categories.map(category => <option key={category} value={category}>{getCategoryEmoji(category)} {category}</option>)}
                            </select>
                          </label>
                        </div>
                      </div>
                    ))}
                    {totalMismatch && <p className="text-[10px] text-amber-700">商品合计与实付不同，通常来自优惠、运费或识别遗漏；保存时保留上方“实际支出”。</p>}
                  </div>
                ) : null}
              </article>
            );
          })}

          <div className="glass-panel rounded-2xl p-4 flex gap-3"><button type="button" onClick={() => { setParsedBatch(null); setRecognizedBill(null); }} className="flex-1 py-3 border border-black/[0.08] text-dark-muted rounded-xl text-xs font-semibold">取消</button><button type="button" disabled={saving} onClick={save} className="flex-1 py-3 bg-brand-purple disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"><Check size={16} />{saving ? '正在入账' : `确认入账 ${parsedBatch.transactions.length} 笔`}</button></div>
        </section>
      )}
    </div>
  );
}

function FieldLabel({ children, icon, label }: { children: React.ReactNode; icon: React.ReactNode; label: string }) {
  return <label className="space-y-1 block"><span className="text-xs text-dark-muted font-medium flex items-center gap-1">{icon} {label}</span>{children}</label>;
}

function CategoryPicker({ categories, onChange, value }: { categories: string[]; onChange: (category: string) => void; value: string }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {categories.map(category => <button key={category} type="button" onClick={() => onChange(category)} className={`text-xs rounded-xl border transition-all active:scale-95 py-2 flex items-center justify-center gap-1 ${value === category ? 'bg-brand-purple/10 border-brand-purple/40 text-brand-purple font-bold' : 'bg-black/[0.02] border-black/[0.05]'}`}><span>{getCategoryEmoji(category)}</span><span>{category}</span></button>)}
    </div>
  );
}
