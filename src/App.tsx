import { useState } from 'react';
import { BookText, ListCollapse, Settings as SettingsIcon, Sparkles, TrendingUp } from 'lucide-react';
import { AIInput } from './components/AIInput';
import { Dashboard } from './components/Dashboard';
import { Settings } from './components/Settings';
import { TransactionList } from './components/TransactionList';
import type { Tab } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(key => key + 1);

  return (
    <div className="app-shell h-dvh bg-dark-bg text-dark-text radial-bg-glow flex flex-col items-center relative overflow-hidden select-none">
      <div className="absolute top-[-100px] left-1/2 -translate-x-1/2 w-[350px] h-[350px] rounded-full bg-brand-purple/10 blur-[80px] pointer-events-none" />
      <div className="absolute top-[220px] left-1/2 -translate-x-1/2 w-[300px] h-[300px] rounded-full bg-brand-cyan/10 blur-[100px] pointer-events-none" />

      <header className="safe-top w-full max-w-md px-4 pb-3 flex justify-between items-center z-40 shrink-0 bg-dark-bg/95 backdrop-blur-xl border-b border-black/[0.03]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-brand-purple to-brand-cyan flex items-center justify-center shadow-lg shadow-brand-purple/20">
            <BookText size={16} className="text-white" />
          </div>
          <span className="text-base font-black tracking-wider">记账</span>
        </div>
        <span className="text-[10px] text-dark-muted font-semibold bg-black/[0.04] border border-black/[0.05] px-2.5 py-1 rounded-full uppercase tracking-wider font-mono">
          v1.2.2.1
        </span>
      </header>

      <main className="flex-1 min-h-0 w-full max-w-md overflow-y-auto no-scrollbar relative z-10 scroll-smooth">
        {activeTab === 'dashboard' && <Dashboard key={`dashboard-${refreshKey}`} />}
        {activeTab === 'input' && (
          <AIInput
            key={`input-${refreshKey}`}
            onTransactionSaved={refresh}
            onNavigateToTransactions={() => setActiveTab('transactions')}
          />
        )}
        {activeTab === 'transactions' && (
          <TransactionList key={`transactions-${refreshKey}`} onTransactionDeleted={refresh} />
        )}
        {activeTab === 'settings' && <Settings key={`settings-${refreshKey}`} onSettingsSaved={refresh} />}
      </main>

      <nav className="safe-bottom-nav fixed left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md h-16 rounded-2xl glass-panel-heavy border border-black/[0.06] z-30 grid grid-cols-4 items-center px-3 shadow-lg shadow-slate-900/5">
        <NavButton active={activeTab === 'dashboard'} label="仪表盘" icon={TrendingUp} onClick={() => setActiveTab('dashboard')} />
        <NavButton active={activeTab === 'transactions'} label="明细" icon={ListCollapse} onClick={() => setActiveTab('transactions')} />
        <button
          type="button"
          aria-label="AI 记账"
          onClick={() => setActiveTab('input')}
          className={`relative -top-3 mx-auto w-13 h-13 rounded-full bg-gradient-to-tr from-brand-purple to-brand-cyan flex items-center justify-center shadow-lg shadow-brand-purple/25 border border-black/5 active:scale-95 transition-all ${
            activeTab === 'input' ? 'scale-110 shadow-[0_4px_20px_rgba(79,70,229,0.3)]' : ''
          }`}
        >
          <Sparkles size={22} className="text-white" />
          <span className="absolute w-full h-full rounded-full border border-brand-purple/20 animate-ping pointer-events-none opacity-25" />
        </button>
        <NavButton active={activeTab === 'settings'} label="设置" icon={SettingsIcon} onClick={() => setActiveTab('settings')} />
      </nav>
    </div>
  );
}

function NavButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof TrendingUp;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 py-1.5 px-2 rounded-xl transition-all active:scale-95 ${
        active ? 'text-brand-purple scale-105' : 'text-dark-muted hover:text-dark-text'
      }`}
    >
      <Icon size={20} className={active ? 'neon-text-glow' : ''} />
      <span className="text-[9px] font-bold tracking-wider">{label}</span>
    </button>
  );
}
