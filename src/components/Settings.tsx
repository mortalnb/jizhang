import React, { useState, useEffect } from 'react';
import { db, AppSettings } from '../utils/db';
import { getCategoryEmoji } from '../utils/ai';
import { Key, Globe, Cpu, Wallet, RotateCcw, Save, CheckCircle, AlertTriangle, Plus, X, Tag } from 'lucide-react';

interface SettingsProps {
  onSettingsSaved: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ onSettingsSaved }) => {
  const [settings, setSettings] = useState<AppSettings>({
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    monthlyBudget: 3000,
    categories: [],
  });

  const [newCatInput, setNewCatInput] = useState('');

  const [toast, setToast] = useState<{ show: boolean; msg: string; type: 'success' | 'warn' }>({
    show: false,
    msg: '',
    type: 'success',
  });

  useEffect(() => {
    const s = db.getSettings();
    setSettings(s);
  }, []);

  const triggerToast = (msg: string, type: 'success' | 'warn' = 'success') => {
    setToast({ show: true, msg, type });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 2500);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (settings.categories.length === 0) {
      triggerToast('必须至少保留一个分类科目！', 'warn');
      return;
    }
    db.saveSettings(settings);
    triggerToast('设置与分类科目保存成功！');
    onSettingsSaved();
  };

  const handleResetData = () => {
    if (window.confirm('🚨 确定要清空所有账单数据并恢复默认吗？此操作不可逆！')) {
      db.resetAll();
      const defaultS = db.getSettings();
      setSettings(defaultS);
      triggerToast('所有配置已完全重置！', 'warn');
      onSettingsSaved();
    }
  };

  // 添加分类
  const handleAddCategory = () => {
    const trimmed = newCatInput.trim();
    if (!trimmed) return;
    if (settings.categories.includes(trimmed)) {
      triggerToast('该分类已存在！', 'warn');
      return;
    }
    if (trimmed.length > 6) {
      triggerToast('分类名称不要超过 6 个字！', 'warn');
      return;
    }
    setSettings({
      ...settings,
      categories: [...settings.categories, trimmed],
    });
    setNewCatInput('');
  };

  // 删除分类
  const handleRemoveCategory = (catToRemove: string) => {
    if (settings.categories.length <= 1) {
      triggerToast('必须保留至少一个分类！', 'warn');
      return;
    }
    setSettings({
      ...settings,
      categories: settings.categories.filter(c => c !== catToRemove),
    });
  };

  return (
    <div className="w-full max-w-md mx-auto p-4 space-y-6 animate-slide-up pb-24">
      {/* Toast 提示 */}
      {toast.show && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl shadow-lg glass-panel-heavy z-50 flex items-center gap-2 border border-black/[0.08] transition-all duration-300 ${
          toast.type === 'success' 
            ? 'border-brand-success/30 text-brand-success' 
            : 'border-brand-rose/30 text-brand-rose'
        }`}>
          {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
          <span className="text-sm font-medium">{toast.msg}</span>
        </div>
      )}

      {/* 头部标题 */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-dark-text flex items-center gap-2">
          高级设置 <span className="text-xs bg-brand-purple/10 text-brand-purple px-2.5 py-0.5 rounded-full border border-brand-purple/20">配置中心</span>
        </h1>
        <p className="text-xs text-dark-muted">管理您的 AI 密钥、记账大类与月度消费计划</p>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        {/* DeepSeek API Key */}
        <div className="glass-panel rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-black/[0.05] pb-2">
            <Key size={18} className="text-brand-purple" />
            <h2 className="text-sm font-semibold text-dark-text">大模型服务配置</h2>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-dark-muted font-medium flex justify-between">
                <span>DeepSeek API Key</span>
                {!settings.apiKey && <span className="text-brand-orange text-[10px]">当前：本地免Key模拟模式</span>}
                {settings.apiKey && <span className="text-brand-success text-[10px]">当前：真实大模型接口</span>}
              </label>
              <input
                type="password"
                placeholder="请输入您的 sk-..."
                value={settings.apiKey}
                onChange={e => setSettings({ ...settings, apiKey: e.target.value })}
                className="w-full text-sm bg-dark-surface border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-dark-text focus:outline-none focus:border-brand-purple transition-all ai-pulse-glow"
              />
              <p className="text-[10px] text-dark-muted leading-relaxed">
                * 本地免Key模式：APP 采用轻量正则进行记账解析。填入 API Key 后将启动真实高精度 DeepSeek V4 Flash 级大模型进行语义解析。
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-dark-muted font-medium">API 代理基址 (Base URL)</label>
              <div className="relative">
                <Globe size={14} className="absolute left-3.5 top-3.5 text-dark-muted" />
                <input
                  type="text"
                  placeholder="https://api.deepseek.com"
                  value={settings.baseUrl}
                  onChange={e => setSettings({ ...settings, baseUrl: e.target.value })}
                  className="w-full text-sm bg-dark-surface border border-black/[0.08] rounded-xl pl-9 pr-3.5 py-2.5 text-dark-text focus:outline-none focus:border-brand-purple transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-dark-muted font-medium">指定模型 (Model Name)</label>
              <div className="relative">
                <Cpu size={14} className="absolute left-3.5 top-3.5 text-dark-muted" />
                <input
                  type="text"
                  placeholder="deepseek-v4-flash"
                  value={settings.model}
                  onChange={e => setSettings({ ...settings, model: e.target.value })}
                  className="w-full text-sm bg-dark-surface border border-black/[0.08] rounded-xl pl-9 pr-3.5 py-2.5 text-dark-text focus:outline-none focus:border-brand-purple transition-all"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 动态自定义大类科目管理 */}
        <div className="glass-panel rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-black/[0.05] pb-2">
            <Tag size={18} className="text-brand-purple" />
            <h2 className="text-sm font-semibold text-dark-text">分类科目管理</h2>
          </div>

          {/* 已存大类标签云 */}
          <div className="flex flex-wrap gap-2">
            {settings.categories.map(cat => (
              <span
                key={cat}
                className="text-xs bg-black/[0.02] text-dark-text border border-black/[0.08] rounded-xl px-2.5 py-1.5 flex items-center gap-1.5 hover:border-brand-rose/40 hover:text-brand-rose transition-colors group"
              >
                <span>{getCategoryEmoji(cat)}</span>
                <span>{cat}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveCategory(cat)}
                  className="p-0.5 rounded-full hover:bg-brand-rose/20 text-dark-muted group-hover:text-brand-rose transition-colors"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>

          {/* 新增分类小表单 */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="新增科目(如: 加油)"
              value={newCatInput}
              onChange={e => setNewCatInput(e.target.value)}
              className="flex-1 text-xs bg-dark-surface border border-black/[0.08] rounded-xl px-3 py-2 text-dark-text focus:outline-none focus:border-brand-purple"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCategory();
                }
              }}
            />
            <button
              type="button"
              onClick={handleAddCategory}
              className="px-3 bg-black/[0.02] border border-black/[0.08] text-brand-purple hover:bg-brand-purple hover:text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1 active:scale-95 cursor-pointer"
            >
              <Plus size={14} />
              添加
            </button>
          </div>
          <p className="text-[10px] text-dark-muted leading-relaxed">
            * 增删后的大类会实时写入您的本地配置。大模型会在下一次记账解析时**自适应识别**您配置的科目！
          </p>
        </div>

        {/* 财务预算设置 */}
        <div className="glass-panel rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-black/[0.05] pb-2">
            <Wallet size={18} className="text-brand-purple" />
            <h2 className="text-sm font-semibold text-dark-text">个人财务计划</h2>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-dark-muted font-medium">月度消费预算 (人民币 ￥)</label>
            <input
              type="number"
              placeholder="请输入月度预算金额"
              value={settings.monthlyBudget || ''}
              onChange={e => setSettings({ ...settings, monthlyBudget: parseFloat(e.target.value) || 0 })}
              className="w-full text-sm bg-dark-surface border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-dark-text focus:outline-none focus:border-brand-purple transition-all"
            />
            <p className="text-[10px] text-dark-muted">
              * 设定后，仪表盘将以霓虹环形进度条显示预算进度与超支状态。
            </p>
          </div>
        </div>

        {/* 保存与控制按钮 */}
        <div className="flex flex-col gap-3">
          <button
            type="submit"
            className="w-full py-3 bg-gradient-to-r from-brand-purple to-brand-blue hover:opacity-90 active:scale-95 text-white font-bold rounded-xl shadow-md shadow-brand-purple/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Save size={18} />
            保存当前设置
          </button>
          
          <button
            type="button"
            onClick={handleResetData}
            className="w-full py-3 bg-black/[0.02] border border-black/[0.08] text-brand-rose font-medium rounded-xl hover:bg-brand-rose/[0.04] active:scale-95 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <RotateCcw size={16} />
            清空所有数据并重置
          </button>
        </div>
      </form>
    </div>
  );
};
