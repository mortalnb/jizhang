import { useEffect, useState } from 'react';
import { AlertTriangle, BookText, Download, ListCollapse, Plus, Settings as SettingsIcon, TrendingUp } from 'lucide-react';
import { parseBackup } from './services/backup';
import { storage } from './services/storage';
import { cloudLedgerSync } from './services/cloudLedgerSync';
import { AIInput } from './components/AIInput';
import { Dashboard } from './components/Dashboard';
import { Settings } from './components/Settings';
import { TransactionList } from './components/TransactionList';
import type { Tab } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(key => key + 1);
  const recovery = storage.getRecoveryState();

  useEffect(() => cloudLedgerSync.start(), []);

  if (recovery) {
    return <RecoveryScreen reason={recovery.reason} />;
  }

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
          v1.5.0-rc.1
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

function RecoveryScreen({ reason }: { reason: string }) {
  const exportRaw = () => {
    const blob = new Blob([storage.getRecoveryRaw()], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `智能记账-损坏数据快照-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const restore = async (file?: File) => {
    if (!file) return;
    try {
      storage.restoreBackup(parseBackup(await file.text()), 'replace');
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? `恢复失败：${error.message}` : '恢复失败，请选择有效备份。');
    }
  };
  return (
    <div className="app-shell min-h-dvh bg-dark-bg text-dark-text p-5 flex items-center justify-center">
      <section className="glass-panel rounded-2xl p-5 max-w-md space-y-4">
        <AlertTriangle className="text-brand-rose" size={28} />
        <h1 className="text-lg font-bold">账本进入只读恢复模式</h1>
        <p className="text-sm text-dark-muted leading-relaxed">{reason}</p>
        <p className="text-xs text-dark-muted leading-relaxed">为避免继续记账覆盖原始数据，应用已停止读取和写入账本。请先导出原始快照，再通过新版“导入账本”恢复最近一次有效备份。</p>
        <button type="button" onClick={exportRaw} className="w-full py-3 rounded-xl bg-brand-purple text-white font-bold flex items-center justify-center gap-2"><Download size={16} />导出原始恢复快照</button>
        <label className="block w-full py-3 rounded-xl border border-brand-purple/30 text-center text-brand-purple font-bold cursor-pointer">从有效账本备份恢复<input type="file" accept="application/json,.json" className="hidden" onChange={event => void restore(event.target.files?.[0])} /></label>
      </section>
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
