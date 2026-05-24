import React, { useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { AIInput } from './components/AIInput';
import { TransactionList } from './components/TransactionList';
import { Settings } from './components/Settings';
import { TrendingUp, Sparkles, ListCollapse, Settings as SettingsIcon, BookText } from 'lucide-react';

type Tab = 'dashboard' | 'ai-input' | 'transactions' | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  
  // 用于全局刷新各个视图数据的 key 机制
  const [refreshKey, setRefreshKey] = useState(0);

  const forceRefresh = () => setRefreshKey(prev => prev + 1);

  return (
    <div className="min-h-screen bg-dark-bg text-dark-text radial-bg-glow flex flex-col items-center relative select-none">
      
      {/* 极光背景装饰发光团 */}
      <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[350px] h-[350px] rounded-full bg-brand-purple/10 blur-[80px] pointer-events-none"></div>
      <div className="absolute top-[200px] left-1/2 -translate-x-1/2 w-[300px] h-[300px] rounded-full bg-brand-cyan/10 blur-[100px] pointer-events-none"></div>

      {/* 顶部精品导航条 */}
      <header className="w-full max-w-md px-4 py-4 flex justify-between items-center z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-brand-purple to-brand-cyan flex items-center justify-center shadow-lg shadow-brand-purple/20">
            <BookText size={16} className="text-white font-extrabold" />
          </div>
          <span className="text-base font-black text-dark-text tracking-wider">
            记账
          </span>
        </div>
        <div className="text-[10px] text-dark-muted font-semibold bg-black/[0.04] border border-black/[0.05] px-2.5 py-1 rounded-full uppercase tracking-wider font-mono">
          v1.0.0
        </div>
      </header>

      {/* 视图主体容器 */}
      <main className="flex-1 w-full max-w-md overflow-y-auto no-scrollbar relative z-10">
        {activeTab === 'dashboard' && <Dashboard key={refreshKey} />}
        {activeTab === 'ai-input' && (
          <AIInput
            key={refreshKey}
            onTransactionSaved={forceRefresh}
            onNavigateToTransactions={() => setActiveTab('transactions')}
          />
        )}
        {activeTab === 'transactions' && (
          <TransactionList
            key={refreshKey}
            onTransactionDeleted={forceRefresh}
          />
        )}
        {activeTab === 'settings' && (
          <Settings
            key={refreshKey}
            onSettingsSaved={forceRefresh}
          />
        )}
      </main>

      {/* 浮动毛玻璃底部导航栏 */}
      <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md h-16 rounded-2xl glass-panel-heavy border border-black/[0.06] z-30 flex items-center justify-around px-3 shadow-lg shadow-slate-900/5">
        
        {/* 仪表盘 */}
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-xl transition-all active:scale-90 ${
            activeTab === 'dashboard'
              ? 'text-brand-purple scale-105'
              : 'text-dark-muted hover:text-dark-text'
          }`}
        >
          <TrendingUp size={20} className={activeTab === 'dashboard' ? 'neon-text-glow' : ''} />
          <span className="text-[9px] font-bold tracking-wider">仪表盘</span>
        </button>

        {/* 明细流水 */}
        <button
          onClick={() => setActiveTab('transactions')}
          className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-xl transition-all active:scale-90 ${
            activeTab === 'transactions'
              ? 'text-brand-purple scale-105'
              : 'text-dark-muted hover:text-dark-text'
          }`}
        >
          <ListCollapse size={20} className={activeTab === 'transactions' ? 'neon-text-glow' : ''} />
          <span className="text-[9px] font-bold tracking-wider">明细</span>
        </button>

        {/* AI 记账（ prominent 突出呼吸按钮） */}
        <button
          onClick={() => setActiveTab('ai-input')}
          className={`relative -top-3 w-13 h-13 rounded-full bg-gradient-to-tr from-brand-purple to-brand-cyan flex flex-col items-center justify-center shadow-lg shadow-brand-purple/25 border border-black/5 active:scale-95 transition-all group ${
            activeTab === 'ai-input'
              ? 'scale-110 shadow-[0_4px_20px_rgba(79,70,229,0.3)]'
              : 'hover:shadow-[0_4px_15px_rgba(79,70,229,0.2)]'
          }`}
        >
          <Sparkles size={22} className="text-white font-extrabold group-hover:scale-110 transition-transform" />
          <div className="absolute w-full h-full rounded-full border border-brand-purple/20 animate-ping pointer-events-none opacity-30"></div>
        </button>

        {/* 设置 */}
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-xl transition-all active:scale-90 ${
            activeTab === 'settings'
              ? 'text-brand-purple scale-105'
              : 'text-dark-muted hover:text-dark-text'
          }`}
        >
          <SettingsIcon size={20} className={activeTab === 'settings' ? 'neon-text-glow' : ''} />
          <span className="text-[9px] font-bold tracking-wider">设置</span>
        </button>

      </nav>
    </div>
  );
}
