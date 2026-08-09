import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Cloud, CloudDownload, CloudUpload, Cpu, Download, Globe, Key, Plus, RotateCcw, Save, ServerCog, Tag, Upload, Wallet, X } from 'lucide-react';
import { exportBackup, parseBackup } from '../services/backup';
import { getCategoryEmoji } from '../data/categories';
import { cloudApi } from '../services/cloudApi';
import { cloudLedgerSync } from '../services/cloudLedgerSync';
import { storage } from '../services/storage';
import type { AppSettings } from '../types';

interface SettingsProps {
  onSettingsSaved: () => void;
}

export function Settings({ onSettingsSaved }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>(() => storage.getSettings());
  const [cloudSession, setCloudSession] = useState(() => storage.getCloudSession());
  const [cloudUsername, setCloudUsername] = useState('');
  const [cloudPassword, setCloudPassword] = useState('');
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudDiagnostic, setCloudDiagnostic] = useState<string | null>(null);
  const [modelPanel, setModelPanel] = useState<'cloud' | 'custom'>(() => storage.getSettings().aiMode);
  const [newCategory, setNewCategory] = useState('');
  const [testingModel, setTestingModel] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warn' } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [syncState, setSyncState] = useState(() => storage.getCloudSyncState());

  useEffect(() => {
    const refresh = () => setSyncState(storage.getCloudSyncState());
    window.addEventListener('ab-cloud-sync-state', refresh);
    return () => window.removeEventListener('ab-cloud-sync-state', refresh);
  }, []);

  const notify = (message: string, type: 'success' | 'warn' = 'success') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 2200);
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings.categories.length) {
      notify('至少保留一个分类。', 'warn');
      return;
    }
    storage.saveSettings(settings);
    notify('设置已保存。');
    onSettingsSaved();
  };

  const testModel = async () => {
    setTestingModel(true);
    setTestResult(null);
    const useDevProxy = import.meta.env.DEV;
    const endpoint = useDevProxy ? '/__dev_mimo_chat' : `${settings.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const transparentPixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

    try {
      if (modelPanel === 'cloud' && cloudSession?.accessToken) {
        const parsed = await cloudApi.testCapability(settings);
        setTestResult(`文字 ${parsed.text ? '可用' : '异常'} · JSON ${parsed.json ? '可用' : '异常'} · 图片 ${parsed.vision ? '可用' : '可能不支持'} · 语音 ${parsed.audio ? '可用' : '待单独实测'}`);
        notify('云端模型能力测试完成');
        return;
      }

      if (!useDevProxy && !settings.apiKey.trim()) throw new Error('请先填写 API Key');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(useDevProxy ? {} : { Authorization: `Bearer ${settings.apiKey}` }),
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: 0.1,
          max_completion_tokens: 1024,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: '你是模型能力测试助手。只返回 JSON：{"text":true,"json":true,"vision":true}。如果无法读取图片，vision 为 false。',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: '请确认你能返回 JSON，并判断图片是否可读。' },
                { type: 'image_url', image_url: { url: transparentPixel } },
              ],
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const message = payload?.choices?.[0]?.message;
      const content = String(message?.content || message?.reasoning_content || '');
      const cleaned = content.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1)) as {
        json?: boolean;
        text?: boolean;
        vision?: boolean;
      };
      setTestResult(`文字 ${parsed.text ? '可用' : '异常'} · JSON ${parsed.json ? '可用' : '异常'} · 图片 ${parsed.vision ? '可用' : '可能不支持'}`);
      notify('模型能力测试完成');
    } catch (error) {
      setTestResult(error instanceof Error ? `测试失败：${error.message}` : '测试失败：接口返回异常');
      notify('模型能力测试失败', 'warn');
    } finally {
      setTestingModel(false);
    }
  };

  const loginCloud = async () => {
    const username = cloudUsername.trim();
    if (!username || !cloudPassword) {
      notify('请填写云端账号和密码', 'warn');
      return;
    }
    setCloudLoading(true);
    try {
      storage.saveSettings(settings);
      const session = await cloudApi.login(settings, username, cloudPassword);
      setCloudSession(session);
      setCloudPassword('');
      notify('云端服务登录成功');
    } catch (error) {
      notify(error instanceof Error ? `云端登录失败：${error.message}` : '云端登录失败', 'warn');
    } finally {
      setCloudLoading(false);
    }
  };

  const logoutCloud = async () => {
    setCloudLoading(true);
    try {
      await cloudApi.logout(settings);
      const next = { ...settings, cloudSyncEnabled: false };
      storage.saveSettings(next);
      setSettings(next);
      cloudLedgerSync.disable();
      setCloudSession(null);
      notify('已退出云端服务', 'warn');
    } finally {
      setCloudLoading(false);
    }
  };

  const toggleCloudSync = async (enabled: boolean) => {
    if (enabled && !cloudSession?.accessToken) {
      notify('请先登录云端服务，再开启账本同步。', 'warn');
      return;
    }
    const next = { ...settings, cloudSyncEnabled: enabled };
    setSettings(next);
    storage.saveSettings(next);
    onSettingsSaved();
    if (!enabled) {
      cloudLedgerSync.disable();
      notify('云同步已关闭；云端现有快照不会被删除。', 'warn');
      return;
    }
    setCloudLoading(true);
    try {
      await cloudLedgerSync.enable();
      notify(storage.getCloudSyncState().status === 'conflict' ? '发现云端旧快照，请在下方选择处理方式。' : '云同步已开启并完成首次校验。', storage.getCloudSyncState().status === 'conflict' ? 'warn' : 'success');
    } catch (caught) {
      notify(caught instanceof Error ? `开启同步失败：${caught.message}` : '开启同步失败', 'warn');
    } finally {
      setCloudLoading(false);
    }
  };

  const uploadLocalLedger = async () => {
    if (!window.confirm('确定用当前手机账本覆盖云端快照吗？本机数据不会被修改。')) return;
    setCloudLoading(true);
    try {
      await cloudLedgerSync.pushNow(true);
      notify('当前手机账本已上传到云端。');
    } catch (caught) {
      notify(caught instanceof Error ? `上传失败：${caught.message}` : '上传失败', 'warn');
    } finally { setCloudLoading(false); }
  };

  const restoreCloudLedger = async () => {
    if (!window.confirm('确定用云端账本覆盖当前手机账本吗？覆盖前会自动保存一份本地恢复快照。')) return;
    setCloudLoading(true);
    try {
      const snapshot = await cloudLedgerSync.restoreFromCloud();
      setSettings(storage.getSettings());
      notify(`已恢复云端第 ${snapshot.revision} 版，共 ${snapshot.payload.transactions.length} 笔。`);
      onSettingsSaved();
    } catch (caught) {
      notify(caught instanceof Error ? `恢复失败：${caught.message}` : '恢复失败', 'warn');
    } finally { setCloudLoading(false); }
  };

  const runCloudDiagnostic = async () => {
    setCloudLoading(true);
    setCloudDiagnostic(null);
    const baseUrl = settings.cloudBaseUrl.replace(/\/$/, '');
    const lines = [`网络：${navigator.onLine ? '可用' : '不可用'}`];

    const probe = async (label: string, path: string, init?: RequestInit) => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 8000);
      const started = performance.now();
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          ...init,
          signal: controller.signal,
        });
        lines.push(`${label}：HTTP ${response.status} · ${Math.round(performance.now() - started)}ms`);
      } catch {
        lines.push(`${label}：不可用`);
      } finally {
        window.clearTimeout(timer);
      }
    };

    await probe('服务健康', '/health');
    await probe('服务版本', '/api/version');
    try {
      await cloudApi.me(settings);
      lines.push('登录状态：已认证');
    } catch {
      lines.push('登录状态：需要重新登录');
    }

    setCloudDiagnostic(lines.join('\n'));
    setCloudLoading(false);
  };

  const addCategory = () => {
    const value = newCategory.trim();
    if (!value) return;
    if (settings.categories.includes(value)) {
      notify('这个分类已经存在。', 'warn');
      return;
    }
    if (value.length > 6) {
      notify('分类名称建议不超过 6 个字。', 'warn');
      return;
    }
    setSettings(current => ({ ...current, categories: [...current.categories, value] }));
    setNewCategory('');
  };

  const removeCategory = (category: string) => {
    if (settings.categories.length <= 1) {
      notify('至少保留一个分类。', 'warn');
      return;
    }
    setSettings(current => ({ ...current, categories: current.categories.filter(item => item !== category) }));
  };

  const reset = () => {
    if (!window.confirm('确定要清空所有账单和设置并恢复默认值吗？此操作不可撤销。')) return;
    storage.resetAll();
    setSettings(storage.getSettings());
    notify('数据已重置。', 'warn');
    onSettingsSaved();
  };

  const exportLedger = async () => {
    setBackupBusy(true);
    try {
      await exportBackup(storage.createBackup());
      notify('账本备份已生成；请保存到可恢复的位置。');
    } catch (error) {
      notify(error instanceof Error ? `导出失败：${error.message}` : '导出失败', 'warn');
    } finally { setBackupBusy(false); }
  };

  const importLedger = async (file?: File) => {
    if (!file) return;
    setBackupBusy(true);
    try {
      const backup = parseBackup(await file.text());
      const mode = window.confirm(`备份含 ${backup.payload.transactions.length} 笔账目。确定覆盖恢复吗？选择“取消”将合并导入。`) ? 'replace' : 'merge';
      const count = storage.restoreBackup(backup, mode);
      setSettings(storage.getSettings());
      notify(`${mode === 'replace' ? '已恢复' : '已合并'} ${count} 笔账目${backup.recoveredLegacyChecksum ? '；旧版校验缺陷已安全迁移' : ''}。`);
      onSettingsSaved();
    } catch (error) {
      notify(error instanceof Error ? `导入失败：${error.message}` : '导入失败', 'warn');
    } finally { setBackupBusy(false); }
  };

  return (
    <div className="w-full max-w-md mx-auto p-4 space-y-6 animate-slide-up pb-24">
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl shadow-lg glass-panel-heavy z-50 flex items-center gap-2 border transition-all duration-300 ${
            toast.type === 'success' ? 'border-brand-success/30 text-brand-success' : 'border-brand-rose/30 text-brand-rose'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
          <span className="text-sm font-medium">{toast.message}</span>
        </div>
      )}

      <section className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          高级设置
          <span className="text-xs bg-brand-purple/10 text-brand-purple px-2.5 py-0.5 rounded-full border border-brand-purple/20">配置中心</span>
        </h1>
        <p className="text-xs text-dark-muted">本地账本始终优先；只有主动开启云同步后，账单快照才会上传。</p>
      </section>

      <form onSubmit={save} className="space-y-5">
        <Panel icon={modelPanel === 'cloud' ? <Globe size={18} className="text-brand-purple" /> : <Key size={18} className="text-brand-purple" />} title="智能服务">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/[0.03] border border-black/[0.06] p-1">
            <button
              type="button"
              onClick={() => { setModelPanel('cloud'); setSettings(current => ({ ...current, aiMode: 'cloud' })); }}
              className={`h-9 rounded-lg text-xs font-bold transition-all ${modelPanel === 'cloud' ? 'bg-white text-brand-purple shadow-sm' : 'text-dark-muted hover:text-dark-text'}`}
            >
              云端服务
            </button>
            <button
              type="button"
              onClick={() => { setModelPanel('custom'); setSettings(current => ({ ...current, aiMode: 'custom' })); }}
              className={`h-9 rounded-lg text-xs font-bold transition-all ${modelPanel === 'custom' ? 'bg-white text-brand-purple shadow-sm' : 'text-dark-muted hover:text-dark-text'}`}
            >
              自填模型
            </button>
          </div>

          {modelPanel === 'cloud' ? (
            cloudSession ? (
              <div className="space-y-3">
                <p className="text-[11px] text-dark-muted leading-relaxed bg-black/[0.02] border border-black/[0.06] rounded-xl px-3 py-2">
                  已登录：{cloudSession.user.displayName || cloudSession.user.username} · 模型代理{' '}
                  {cloudSession.entitlement?.canUseModelProxy ? '已授权' : '未授权'} · 每日额度 {cloudSession.entitlement?.dailyLimit ?? 0}
                </p>
                <button
                  type="button"
                  onClick={logoutCloud}
                  disabled={cloudLoading}
                  className="w-full py-2.5 rounded-xl bg-black/[0.02] border border-black/[0.08] text-xs font-bold text-brand-rose hover:bg-brand-rose/10 disabled:opacity-50"
                >
                  退出云端服务
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <Input label="用户名" value={cloudUsername} onChange={setCloudUsername} placeholder="friend@example.com" />
                <Input label="密码" type="password" value={cloudPassword} onChange={setCloudPassword} placeholder="••••••••" />
                <button
                  type="button"
                  onClick={loginCloud}
                  disabled={cloudLoading}
                  className="w-full py-2.5 rounded-xl bg-brand-purple text-white text-xs font-bold hover:bg-brand-blue disabled:opacity-50"
                >
                  {cloudLoading ? '正在登录云端服务' : '登录云端服务'}
                </button>
              </div>
            )
          ) : (
            <div className="space-y-4">
              <p className="text-[11px] text-dark-muted leading-relaxed bg-black/[0.02] border border-black/[0.06] rounded-xl px-3 py-2">
                建议使用支持图片理解的视觉模型；如果配置为纯文本模型，截图拆单、商品数量和单位识别可能不完整。
              </p>
              <Input
                label="API Key"
                type="password"
                placeholder="sk-..."
                value={settings.apiKey}
                onChange={apiKey => setSettings({ ...settings, apiKey })}
                hint={settings.apiKey ? '已启用真实接口解析。' : '未填写时使用本地规则解析。'}
              />
              <IconInput
                icon={<Globe size={14} className="text-dark-muted" />}
                label="接口地址"
                value={settings.baseUrl}
                onChange={baseUrl => setSettings({ ...settings, baseUrl })}
              />
              <IconInput
                icon={<Cpu size={14} className="text-dark-muted" />}
                label="模型名称"
                value={settings.model}
                onChange={model => setSettings({ ...settings, model })}
              />
            </div>
          )}


          <button
            type="button"
            onClick={testModel}
            disabled={testingModel}
            className="w-full py-2.5 rounded-xl bg-black/[0.02] border border-black/[0.08] text-xs font-bold text-brand-purple hover:bg-brand-purple/10 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <ServerCog size={14} />
            {testingModel ? '正在测试模型能力' : '测试文字 / JSON / 图片能力'}
          </button>
          {modelPanel === 'cloud' && (
            <button
              type="button"
              onClick={runCloudDiagnostic}
              disabled={cloudLoading}
              className="w-full py-2.5 rounded-xl bg-black/[0.02] border border-black/[0.08] text-xs font-bold text-dark-muted hover:bg-brand-purple/10 hover:text-brand-purple disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              <ServerCog size={14} />
              {cloudLoading ? '正在检查云端连接' : '云端连接诊断'}
            </button>
          )}
          {testResult && <p className="text-[10px] text-dark-muted leading-relaxed bg-black/[0.02] border border-black/[0.06] rounded-xl px-3 py-2">{testResult}</p>}
          {cloudDiagnostic && <pre className="whitespace-pre-wrap text-[10px] text-dark-muted leading-relaxed bg-black/[0.02] border border-black/[0.06] rounded-xl px-3 py-2 font-mono">{cloudDiagnostic}</pre>}
        </Panel>

        <Panel icon={<Cloud size={18} className="text-brand-purple" />} title="账本云同步（可选）">
          <p className="text-[11px] text-dark-muted leading-relaxed">默认关闭。开启后仅同步账单、商品明细、分类和预算；不会上传 API Key、登录 token 或设备凭据。每次本地写入后后台上传，云端恢复始终需要你再次确认。</p>
          <label className="flex items-center justify-between rounded-xl border border-black/[0.07] bg-black/[0.02] px-3 py-2.5">
            <span className="text-xs font-bold">同步本地账本到云端</span>
            <input type="checkbox" checked={settings.cloudSyncEnabled} onChange={event => void toggleCloudSync(event.target.checked)} disabled={cloudLoading} className="h-4 w-4 accent-brand-purple" />
          </label>
          <div className="rounded-xl border border-black/[0.06] bg-black/[0.02] px-3 py-2 text-[10px] text-dark-muted leading-relaxed">
            状态：{syncState.status === 'disabled' ? '已关闭' : syncState.status === 'syncing' ? '同步中' : syncState.status === 'idle' ? `已同步 · 云端第 ${syncState.revision} 版` : syncState.status === 'conflict' ? '存在版本冲突，自动上传已暂停' : '同步异常'}
            {syncState.lastSyncedAt ? <><br />最近同步：{new Date(syncState.lastSyncedAt).toLocaleString()}</> : null}
            {syncState.error ? <><br /><span className="text-amber-700">{syncState.error}</span></> : null}
          </div>
          {settings.cloudSyncEnabled && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={uploadLocalLedger} disabled={cloudLoading || !cloudSession} className="py-2.5 rounded-xl bg-brand-purple text-white text-[10px] font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"><CloudUpload size={14} />用本机覆盖云端</button>
              <button type="button" onClick={restoreCloudLedger} disabled={cloudLoading || !cloudSession} className="py-2.5 rounded-xl border border-brand-purple/25 text-brand-purple text-[10px] font-bold disabled:opacity-50 flex items-center justify-center gap-1.5"><CloudDownload size={14} />从云端恢复本机</button>
            </div>
          )}
        </Panel>

        <Panel icon={<Tag size={18} className="text-brand-purple" />} title="分类科目">
          <div className="flex flex-wrap gap-2">
            {settings.categories.map(category => (
              <span key={category} className="text-xs bg-black/[0.02] border border-black/[0.08] rounded-xl px-2.5 py-1.5 flex items-center gap-1.5 hover:border-brand-rose/40 group">
                <span>{getCategoryEmoji(category)}</span>
                <span>{category}</span>
                <button type="button" onClick={() => removeCategory(category)} className="p-0.5 rounded-full hover:bg-brand-rose/20 text-dark-muted group-hover:text-brand-rose">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="新增分类"
              value={newCategory}
              onChange={event => setNewCategory(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addCategory();
                }
              }}
              className="flex-1 text-xs bg-dark-surface border border-black/[0.08] rounded-xl px-3 py-2 focus:outline-none focus:border-brand-purple"
            />
            <button type="button" onClick={addCategory} className="px-3 bg-black/[0.02] border border-black/[0.08] text-brand-purple hover:bg-brand-purple hover:text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1">
              <Plus size={14} />
              添加
            </button>
          </div>
        </Panel>

        <Panel icon={<Wallet size={18} className="text-brand-purple" />} title="财务计划">
          <Input
            label="月度消费预算"
            type="number"
            value={String(settings.monthlyBudget)}
            onChange={monthlyBudget => setSettings({ ...settings, monthlyBudget: Number(monthlyBudget) || 0 })}
            hint="仪表盘会根据预算展示进度和预警。"
          />
        </Panel>

        <Panel icon={<Download size={18} className="text-brand-purple" />} title="账本备份与恢复">
          <p className="text-[11px] text-dark-muted leading-relaxed">导出包含账单、拆单、分类和预算，不包含 API Key、云端 token 或设备标识。应用会在写入前创建恢复快照；仍建议定期导出到手机文档目录。</p>
          <button type="button" onClick={exportLedger} disabled={backupBusy} className="w-full py-2.5 rounded-xl bg-brand-purple text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2"><Download size={14} />{backupBusy ? '正在处理备份' : '导出账本备份'}</button>
          <label className="w-full py-2.5 rounded-xl bg-black/[0.02] border border-black/[0.08] text-xs font-bold text-brand-purple flex items-center justify-center gap-2 cursor-pointer"><Upload size={14} />导入账本备份<input type="file" accept="application/json,.json" className="hidden" onChange={event => void importLedger(event.target.files?.[0])} /></label>
        </Panel>

        <div className="flex flex-col gap-3">
          <button type="submit" className="w-full py-3 bg-brand-purple text-white font-bold rounded-xl shadow-sm flex items-center justify-center gap-2 transition-all">
            <Save size={18} />
            保存当前设置
          </button>
          <button type="button" onClick={reset} className="w-full py-3 bg-black/[0.02] border border-black/[0.08] text-brand-rose font-medium rounded-xl hover:bg-brand-rose/[0.04] flex items-center justify-center gap-2 transition-all">
            <RotateCcw size={16} />
            清空数据并重置
          </button>
        </div>
      </form>
    </div>
  );
}

function Panel({ children, icon, title }: { children: React.ReactNode; icon: React.ReactNode; title: string }) {
  return (
    <section className="glass-panel rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2 border-b border-black/[0.05] pb-2">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Input({
  hint,
  label,
  onChange,
  placeholder,
  type = 'text',
  value,
}: {
  hint?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  return (
    <label className="space-y-1.5 block">
      <span className="text-xs text-dark-muted font-medium">{label}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="w-full text-sm bg-dark-surface border border-black/[0.08] rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-brand-purple transition-all"
      />
      {hint && <p className="text-[10px] text-dark-muted leading-relaxed">{hint}</p>}
    </label>
  );
}

function IconInput({ icon, label, onChange, value }: { icon: React.ReactNode; label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="space-y-1.5 block">
      <span className="text-xs text-dark-muted font-medium">{label}</span>
      <div className="relative">
        <span className="absolute left-3.5 top-3.5">{icon}</span>
        <input
          type="text"
          value={value}
          onChange={event => onChange(event.target.value)}
          className="w-full text-sm bg-dark-surface border border-black/[0.08] rounded-xl pl-9 pr-3.5 py-2.5 focus:outline-none focus:border-brand-purple transition-all"
        />
      </div>
    </label>
  );
}
