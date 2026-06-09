import { useState } from 'react';
import { BookText, ListCollapse, Plus, Settings as SettingsIcon, TrendingUp } from 'lucide-react';
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
      <header className="app-header safe-top w-full max-w-md px-4 pb-3 flex justify-between items-center z-40 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-dark-surface border border-black/[0.06] flex items-center justify-center shadow-sm">
            <BookText size={16} className="text-brand-purple" />
          </div>
          <span className="text-base font-semibold tracking-normal">记账</span>
        </div>
        <span className="text-[10px] text-dark-muted font-semibold bg-white/70 border border-black/[0.06] px-2.5 py-1 rounded-full uppercase tracking-wider font-mono">
          v1.4.3
        </span>
      </header>

      <main className="app-main flex-1 min-h-0 w-full max-w-md overflow-y-auto no-scrollbar relative z-10 scroll-smooth">
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

      <nav className="app-nav safe-bottom-nav fixed left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md h-16 rounded-2xl z-30 grid grid-cols-4 items-center px-3">
        <NavButton active={activeTab === 'dashboard'} label="仪表盘" icon={TrendingUp} onClick={() => setActiveTab('dashboard')} />
        <NavButton active={activeTab === 'transactions'} label="明细" icon={ListCollapse} onClick={() => setActiveTab('transactions')} />
        <button
          type="button"
          aria-label="记一笔"
          onClick={() => setActiveTab('input')}
          className={`relative -top-3 mx-auto w-13 h-13 rounded-full bg-brand-purple flex items-center justify-center shadow-md shadow-slate-900/10 border border-white active:scale-95 transition-all ${
            activeTab === 'input' ? 'scale-105 bg-brand-blue' : ''
          }`}
        >
          <Plus size={23} className="text-white" />
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
        active ? 'text-brand-purple' : 'text-dark-muted hover:text-dark-text'
      }`}
    >
      <Icon size={20} />
      <span className="text-[9px] font-semibold tracking-normal">{label}</span>
    </button>
  );
}
