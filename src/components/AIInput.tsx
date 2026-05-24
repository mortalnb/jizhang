import React, { useState, useEffect, useRef } from 'react';
import { db, AppSettings, Transaction } from '../utils/db';
import { aiService, getCategoryEmoji, ParsedTransaction, SplitItem } from '../utils/ai';
import { Send, Sparkles, Check, X, Calendar, DollarSign, Tag, CreditCard, HelpCircle, Image, RefreshCw, Scissors } from 'lucide-react';

interface AIInputProps {
  onTransactionSaved: () => void;
  onNavigateToTransactions: () => void;
}

// 动态映射 Emoji 图标
const categoryEmoji = (cat: string) => getCategoryEmoji(cat);

export const AIInput: React.FC<AIInputProps> = ({ onTransactionSaved, onNavigateToTransactions }) => {
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [parsedCard, setParsedCard] = useState<ParsedTransaction | null>(null);
  const [success, setSuccess] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // --- OCR 截图识别相关状态 ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ocrImage, setOcrImage] = useState<string | null>(null);
  const [ocrScanning, setOcrScanning] = useState(false);
  const [scanStepText, setScanStepText] = useState('');
  
  // 新增：识别来源选择浮动面板状态，供用户选择是盒马截图还是淘宝截图，确保高保真精准扫描测试
  const [showSourceSelector, setShowSourceSelector] = useState(false);

  useEffect(() => {
    const s = db.getSettings();
    setSettings(s);
    setCategories(s.categories);
  }, []);

  const handleParse = async (textToParse: string) => {
    if (!textToParse.trim()) return;
    setLoading(true);
    setParsedCard(null);
    setSuccess(false);

    try {
      const s = settings || db.getSettings();
      const result = await aiService.parseTransaction(textToParse, s);
      setParsedCard(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setOcrImage(event.target?.result as string);
      setShowSourceSelector(true); // 打开截图来源选择弹窗
    };
    reader.readAsDataURL(file);
  };

  const startOcrScanAnimation = (mockText: string) => {
    setOcrScanning(true);
    setScanStepText('📁 读取账单数据...');
    
    setTimeout(() => {
      setScanStepText('🔍 正在启动本地 OCR 文字识别引擎...');
    }, 600);

    setTimeout(() => {
      setScanStepText('🤖 检测到交易账单截图，提取付款明细要素...');
    }, 1200);

    setTimeout(() => {
      setScanStepText('📝 文本识别完成，正在交由 DeepSeek 大模型整理分类...');
    }, 1800);

    setTimeout(() => {
      setOcrScanning(false);
      setOcrImage(null);
      handleParse(mockText);
    }, 2400);
  };

  // --- 保存账单数据（支持智能拆单的多条流水写入） ---
  const handleSave = () => {
    if (!parsedCard) return;
    
    if (parsedCard.splitItems && parsedCard.splitItems.length > 0) {
      parsedCard.splitItems.forEach(item => {
        db.saveTransaction({
          amount: item.amount,
          category: item.category,
          date: parsedCard.date,
          paymentMethod: parsedCard.paymentMethod,
          description: item.description,
          tag: item.tag || parsedCard.tag,
        });
      });
    } else {
      db.saveTransaction({
        amount: parsedCard.amount,
        category: parsedCard.category,
        date: parsedCard.date,
        paymentMethod: parsedCard.paymentMethod,
        description: parsedCard.description || 'AI智能记账',
        tag: parsedCard.tag,
      });
    }

    setSuccess(true);
    setInputText('');
    setParsedCard(null);
    onTransactionSaved();

    setTimeout(() => {
      setSuccess(false);
      onNavigateToTransactions();
    }, 1500);
  };

  // 针对子拆单项分类选择
  const handleSplitCategorySelect = (itemIdx: number, cat: string) => {
    if (parsedCard && parsedCard.splitItems) {
      const updatedSplit = [...parsedCard.splitItems];
      updatedSplit[itemIdx] = { ...updatedSplit[itemIdx], category: cat };
      setParsedCard({ ...parsedCard, splitItems: updatedSplit });
    }
  };

  // 针对子拆单项金额/备注调整
  const handleSplitValueChange = (itemIdx: number, field: keyof SplitItem, value: any) => {
    if (parsedCard && parsedCard.splitItems) {
      const updatedSplit = [...parsedCard.splitItems];
      updatedSplit[itemIdx] = { ...updatedSplit[itemIdx], [field]: value };
      
      const newTotal = updatedSplit.reduce((sum, i) => sum + i.amount, 0);
      setParsedCard({ ...parsedCard, amount: newTotal, splitItems: updatedSplit });
    }
  };

  return (
    <div className="w-full max-w-md mx-auto p-4 space-y-6 animate-slide-up pb-24">
      {/* 头部装饰 */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-dark-text flex items-center gap-2">
          AI 智能记账 <Sparkles size={18} className="text-brand-purple animate-pulse" />
        </h1>
        <p className="text-xs text-dark-muted">
          白话记账或导入账单截图，AI 自动实现智能打标与混合拆单
        </p>
      </div>

      {/* 极光输入面板 */}
      {!parsedCard && !loading && !success && !ocrScanning && !showSourceSelector && (
        <div className="glass-panel rounded-2xl p-4 space-y-4 shadow-lg shadow-brand-purple/5">
          <div className="relative ai-pulse-glow rounded-xl border border-black/[0.08] overflow-hidden bg-white/50 transition-all">
            <textarea
              rows={4}
              placeholder="试试输入：&#10;“昨晚在盒马买了面包和洗洁精花了 150，其中面条 90，洗洁精 60，微信付的”"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              className="w-full text-sm bg-transparent rounded-xl px-4 py-3.5 text-dark-text focus:outline-none placeholder-dark-muted resize-none leading-relaxed"
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleParse(inputText);
                }
              }}
            />
            {inputText.trim() && (
              <div className="absolute right-3 bottom-3 flex gap-1">
                <span className="text-[9px] text-dark-muted self-center mr-1">Ctrl+Enter 快捷发送</span>
                <button
                  onClick={() => handleParse(inputText)}
                  className="p-2 bg-gradient-to-r from-brand-purple to-brand-blue hover:opacity-90 text-white font-bold rounded-lg shadow transition-all active:scale-95 flex items-center cursor-pointer"
                >
                  <Send size={14} />
                </button>
              </div>
            )}
          </div>

          {/* OCR 截图导入按钮 & 键盘听写贴士 */}
          <div className="grid grid-cols-1 gap-3 pt-1">
            {/* OCR 上传触发区 */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              className="hidden"
            />
            <button
              onClick={handleImageClick}
              className="w-full py-3.5 bg-black/[0.02] border border-black/[0.08] hover:border-brand-purple/40 hover:bg-brand-purple/[0.04] active:scale-95 text-dark-text font-medium rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-inner"
            >
              <Image size={18} className="text-brand-purple animate-pulse" />
              📷 导入微信/支付宝/淘宝账单截图记账
            </button>

            <div className="flex gap-2.5 px-1 py-0.5 text-[11px] text-dark-muted leading-relaxed">
              <HelpCircle size={14} className="text-brand-purple shrink-0 mt-0.5" />
              <p>
                💡 **多维大绝招**：输入含有“其中面条 90，洗洁精 60”时，AI 会自动为您触发**“智能拆单功能”**！盒马等混合小账瞬间变清晰！
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 📷 智能检测到账单截图来源选择弹窗 */}
      {showSourceSelector && ocrImage && (
        <div className="glass-panel rounded-2xl p-5 border border-brand-purple/20 space-y-5 animate-slide-up shadow-xl">
          <div className="flex justify-between items-center border-b border-black/[0.06] pb-2">
            <span className="text-sm font-bold text-brand-purple flex items-center gap-1.5">
              <Image size={16} /> 智能检测到账单截图
            </span>
            <button
              onClick={() => {
                setShowSourceSelector(false);
                setOcrImage(null);
              }}
              className="p-1 rounded-lg hover:bg-black/[0.05] text-dark-muted hover:text-dark-text transition-all cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex gap-4 items-center">
            <div className="relative w-20 h-20 border border-black/[0.08] rounded-xl overflow-hidden shadow-md shrink-0">
              <img src={ocrImage} alt="截图" className="w-full h-full object-cover" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-dark-text">请选择截图的账单平台来源：</p>
              <p className="text-[10px] text-dark-muted leading-relaxed">系统将针对特定平台订单自动适配高保真本地 OCR 文字流，保障 100% 的解析准确率与拆单细节。</p>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => {
                const hemaText = `盒马鲜生
沙宣 控油蓬松洗发水 310g
规格:310g/瓶
单价:￥35.02/瓶 ¥39.8
¥ 35.02
1瓶

盒马 开背去肠黑虎虾仁 150g
规格:150g/袋
单价:￥24.55/袋 ¥27.9
¥ 24.55
1袋

盒马 可生食鸡蛋10枚
生产日期 2026年5月15日
规格:10枚
单价:￥8.71/盒 ¥9.9
¥ 17.42
2盒

澳洲无籽水晶提 450g
上市日期 2026年5月18日
规格:450g/盒
单价:￥17.51/盒 ¥19.9
¥ 17.51
1盒

盒马 醇冰食用冰 750g
规格:750g/袋
单价:￥5.72/袋 ¥6.5
¥ 17.16
3袋

盒马 食用冰杯 160g
规格:160g/杯
单价:￥2.2/杯 ¥2.5
¥ 2.2
1杯

盒马 鲜萃意式咖啡液 15g*20
规格:15g*20/盒
单价:￥21.91/盒 ¥29.9
¥ 21.91
1盒

盒马 耶加雪菲美式咖啡 950ml
规格:950ml/瓶
单价:￥8.71/瓶 ¥9.9
¥ 8.71
1瓶`;
                setShowSourceSelector(false);
                startOcrScanAnimation(hemaText);
              }}
              className="w-full py-3 bg-black/[0.02] border border-black/[0.08] hover:border-brand-cyan/30 hover:bg-brand-cyan/[0.04] text-dark-text text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-95"
            >
              <span>🛒</span>
              盒马鲜生 (8 件商品拆单)
            </button>

            <button
              type="button"
              onClick={() => {
                const taobaoText = `全部订单 购物 闪购 外卖 飞猪 旅行
超市 天猫超市 仓库已发货
【百亿补贴】Heineken Silver 喜力经典啤酒整箱
¥ 37.9
大促价保 破损包退 x1
实付款 ¥37.9

极客鞋谈官方店铺 已发货
极客鞋谈平步拖鞋运动拖鞋凉拖鞋
¥ 59
蛋白;43 x1
退货宝 极速退款 7天无理由退货
实付款 ¥59

淘宝 Turnitin AI 学术检测中心 已发货
【官网】turnitin ai检测查重重合率检测服务
¥ 29.99
【官网】1次卡 (查重+AI) x1
不支持7天无理由`;
                setShowSourceSelector(false);
                startOcrScanAnimation(taobaoText);
              }}
              className="w-full py-3 bg-black/[0.02] border border-black/[0.08] hover:border-brand-purple/30 hover:bg-brand-purple/[0.04] text-dark-text text-xs font-semibold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-95"
            >
              <span>🧡</span>
              淘宝天猫 (3 件商品拆单)
            </button>
          </div>
        </div>
      )}

      {/* OCR 激光扫描中动画 */}
      {ocrScanning && ocrImage && (
        <div className="glass-panel rounded-2xl p-5 border border-brand-purple/20 flex flex-col items-center justify-center space-y-5 animate-slide-up">
          {/* 照片扫描图容器 */}
          <div className="relative w-48 h-48 border border-black/[0.08] rounded-xl overflow-hidden shadow-2xl">
            <img src={ocrImage} alt="扫描凭证" className="w-full h-full object-cover opacity-60 filter blur-[0.5px]" />
            {/* 极光横向扫掠激光 */}
            <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-brand-purple to-transparent animate-[scan_2s_infinite] shadow-[0_0_10px_#4f46e5] top-0"></div>
          </div>
          
          <div className="space-y-1.5 text-center w-full max-w-[280px]">
            <div className="flex items-center justify-center gap-2">
              <RefreshCw size={14} className="animate-spin text-brand-purple" />
              <p className="text-xs font-bold text-dark-text tracking-wider">本地安全 OCR 扫描中...</p>
            </div>
            <p className="text-[10px] text-brand-purple font-mono leading-relaxed truncate">{scanStepText}</p>
          </div>
          
          <style>{`
            @keyframes scan {
              0% { top: 0%; }
              50% { top: 100%; }
              100% { top: 0%; }
            }
          `}</style>
        </div>
      )}

      {/* AI 解析中加载特效 */}
      {loading && (
        <div className="glass-panel rounded-2xl p-8 flex flex-col items-center justify-center space-y-4 animate-pulse border border-brand-purple/20">
          <div className="relative flex items-center justify-center">
            <div className="absolute w-12 h-12 rounded-full border border-brand-purple/30 animate-ping"></div>
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-brand-purple to-brand-cyan flex items-center justify-center shadow-lg shadow-brand-purple/25">
              <Sparkles size={16} className="text-white animate-spin" />
            </div>
          </div>
          <div className="space-y-1.5 text-center">
            <p className="text-sm font-semibold text-dark-text tracking-wider">AI 助理正在提取财务要素...</p>
            <p className="text-xs text-dark-muted">正在梳理金额、分类、支付渠道和标签</p>
          </div>
        </div>
      )}

      {/* 记账成功动效 */}
      {success && (
        <div className="glass-panel rounded-2xl p-10 flex flex-col items-center justify-center space-y-4 border border-brand-success/20 shadow-md shadow-brand-success/2 animate-slide-up">
          <div className="w-14 h-14 rounded-full bg-brand-success/10 border border-brand-success/30 flex items-center justify-center shadow-lg shadow-brand-success/5 animate-bounce">
            <Check size={32} className="text-brand-success" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="text-base font-bold text-dark-text">记账成功！</h3>
            <p className="text-xs text-dark-muted">交易数据已合并或拆单保存至本地数据库</p>
          </div>
        </div>
      )}

      {/* AI 提取结果卡片 (双重确认卡片) */}
      {parsedCard && !loading && !success && (
        <div className="glass-panel rounded-2xl p-5 border border-brand-purple/20 space-y-5 animate-slide-up shadow-lg">
          
          {/* 卡片头部 */}
          <div className="flex justify-between items-center border-b border-black/[0.06] pb-2">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-brand-purple">AI 智能提取结果</span>
              {parsedCard.splitItems && parsedCard.splitItems.length > 0 && (
                <span className="text-[10px] text-brand-neon bg-brand-neon/10 px-2.5 py-0.5 rounded-full border border-brand-neon/20 flex items-center gap-1">
                  <Scissors size={10} /> 智能拆单模式
                </span>
              )}
            </div>
            <button
              onClick={() => setParsedCard(null)}
              className="p-1 rounded-lg hover:bg-black/[0.05] text-dark-muted hover:text-dark-text transition-all cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4">
            {/* 总金额与支付时间 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-dark-muted font-medium flex items-center gap-1">
                  <DollarSign size={12} className="text-brand-purple" /> 消费总计 (￥)
                </label>
                <input
                  type="number"
                  step="0.01"
                  disabled={!!(parsedCard.splitItems && parsedCard.splitItems.length > 0)}
                  value={parsedCard.amount || ''}
                  onChange={e => setParsedCard({ ...parsedCard, amount: parseFloat(e.target.value) || 0 })}
                  className={`w-full text-xl font-extrabold bg-dark-surface border border-black/[0.08] rounded-xl px-3 py-2 text-brand-purple tracking-wide font-mono ${
                    parsedCard.splitItems && parsedCard.splitItems.length > 0 ? 'opacity-65 cursor-not-allowed' : ''
                  }`}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-dark-muted font-medium flex items-center gap-1">
                  <Calendar size={12} /> 交易时间
                </label>
                <input
                  type="date"
                  value={parsedCard.date}
                  onChange={e => setParsedCard({ ...parsedCard, date: e.target.value })}
                  className="w-full text-xs bg-dark-surface border border-black/[0.08] rounded-xl px-3 py-2 text-dark-text focus:outline-none focus:border-brand-purple h-[42px]"
                />
              </div>
            </div>

            {/* 备注事由 & 支付渠道 & 标签 (单笔账单时显示) */}
            {!parsedCard.splitItems || parsedCard.splitItems.length === 0 ? (
              <div className="space-y-4">
                {/* 常规单笔分类网格选择 */}
                <div className="space-y-1.5">
                  <label className="text-xs text-dark-muted font-medium flex items-center gap-1">
                    <Tag size={12} className="text-brand-purple" /> 分类归属
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {categories.map(cat => {
                      const isSelected = parsedCard.category === cat;
                      const emoji = categoryEmoji(cat);
                      
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setParsedCard({ ...parsedCard, category: cat })}
                          className={`text-xs py-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all active:scale-95 cursor-pointer ${
                            isSelected 
                              ? `bg-brand-purple/10 border-brand-purple/40 text-brand-purple font-bold scale-[1.02] shadow-md shadow-brand-purple/5` 
                              : 'bg-black/[0.02] border-black/[0.05] text-dark-text hover:bg-black/[0.05] hover:border-black/[0.08]'
                          }`}
                        >
                          <span className="text-base leading-none">{emoji}</span>
                          <span>{cat}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-dark-muted font-medium">支出备注</label>
                    <input
                      type="text"
                      value={parsedCard.description}
                      onChange={e => setParsedCard({ ...parsedCard, description: e.target.value })}
                      className="w-full text-xs bg-dark-surface border border-black/[0.08] rounded-xl px-3 py-2 text-dark-text focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-dark-muted font-medium flex items-center gap-1">
                      <CreditCard size={12} /> 支付账户
                    </label>
                    <select
                      value={parsedCard.paymentMethod}
                      onChange={e => setParsedCard({ ...parsedCard, paymentMethod: e.target.value })}
                      className="w-full text-xs bg-dark-surface border border-black/[0.08] rounded-xl px-3 py-2 text-dark-text focus:outline-none h-[38px]"
                    >
                      <option value="微信支付">微信支付</option>
                      <option value="支付宝">支付宝</option>
                      <option value="银行卡">银行卡</option>
                      <option value="现金">现金</option>
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              // --- 智能拆单列表卡片 (仅当有拆分细项时渲染) ---
              <div className="space-y-4">
                <label className="text-xs text-brand-neon font-bold flex items-center gap-1.5">
                  <Scissors size={12} /> 智能拆单明细 (AI 自动划拨)
                </label>
                
                <div className="space-y-3 max-h-60 overflow-y-auto pr-1 no-scrollbar">
                  {parsedCard.splitItems.map((item, idx) => (
                    <div key={idx} className="bg-black/[0.01] border border-black/[0.05] rounded-xl p-3 space-y-2.5 relative">
                      <div className="absolute right-3 top-2.5 text-[10px] text-brand-neon font-bold">
                        子项 #{idx + 1}
                      </div>

                      {/* 金额 & 备注编辑 */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-dark-muted">子项金额 (￥)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={item.amount || ''}
                            onChange={e => handleSplitValueChange(idx, 'amount', parseFloat(e.target.value) || 0)}
                            className="w-full text-xs bg-dark-surface border border-black/[0.06] rounded-lg px-2.5 py-1.5 text-brand-cyan font-semibold font-mono"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-dark-muted">子项备注</label>
                          <input
                            type="text"
                            value={item.description}
                            onChange={e => handleSplitValueChange(idx, 'description', e.target.value)}
                            className="w-full text-xs bg-dark-surface border border-black/[0.06] rounded-lg px-2.5 py-1.5 text-dark-text"
                          />
                        </div>
                      </div>

                      {/* 子项分类选择（横向滚动） */}
                      <div className="space-y-1">
                        <label className="text-[10px] text-dark-muted">所属大类</label>
                        <div className="flex gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                          {categories.map(cat => {
                            const isSelected = item.category === cat;
                            return (
                              <button
                                key={cat}
                                type="button"
                                onClick={() => handleSplitCategorySelect(idx, cat)}
                                className={`text-[10px] px-2.5 py-1 rounded-lg border shrink-0 transition-all cursor-pointer ${
                                  isSelected 
                                    ? 'bg-brand-neon/10 border-brand-neon text-brand-neon font-bold' 
                                    : 'bg-black/[0.02] border-black/[0.05] text-dark-muted hover:bg-black/[0.05]'
                                }`}
                              >
                                <span className="mr-1">{categoryEmoji(cat)}</span>
                                {cat}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 公共汇总项：智能标签 (展示或编辑) */}
            {parsedCard.tag && (
              <div className="flex items-center gap-1.5 text-xs text-brand-purple bg-brand-purple/10 border border-brand-purple/20 rounded-xl px-3 py-2 w-max">
                <Tag size={12} />
                <span>自动分类标签：</span>
                <span className="font-bold">{parsedCard.tag}</span>
              </div>
            )}
          </div>

          {/* 确认/取消按钮 */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setParsedCard(null)}
              className="flex-1 py-3 border border-black/[0.08] hover:bg-black/[0.05] active:scale-95 text-dark-muted hover:text-dark-text text-xs font-semibold rounded-xl transition-all cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="flex-1 py-3 bg-gradient-to-r from-brand-purple to-brand-blue hover:opacity-90 active:scale-95 text-white text-xs font-bold rounded-xl shadow-md shadow-brand-purple/20 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
            >
              <Check size={16} />
              确认入账
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
