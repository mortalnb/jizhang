import { DEFAULT_CATEGORIES } from '../data/categories';
import type { AppSettings, CloudSession, Transaction } from '../types';
import { checksum, createBackup, saveAutomaticBackup, type LedgerBackup } from './backup';

const TRANSACTIONS_KEY = 'ab_transactions';
const SETTINGS_KEY = 'ab_settings';
const SCHEMA_KEY = 'ab_schema_version';
const CLOUD_SESSION_KEY = 'ab_cloud_session';
const DEVICE_ID_KEY = 'ab_device_id';
const CURRENT_SCHEMA_VERSION = 3;
const MANIFEST_KEY = 'ab_integrity_manifest';
const RECOVERY_KEY = 'ab_recovery_snapshot';
const SEED_ID_PATTERN = /^seed-00[1-9]$/;
const LEGACY_MODEL_PATTERN = new RegExp(['deep', 'seek'].join(''), 'i');

export const DEFAULT_SETTINGS: AppSettings = {
  aiMode: 'custom',
  apiKey: '',
  baseUrl: 'https://api.xiaomimimo.com',
  cloudBaseUrl: import.meta.env.VITE_CLOUD_BASE_URL || 'https://app.mortalnb.com',
  model: 'mimo-v2.5',
  monthlyBudget: 3000,
  categories: DEFAULT_CATEGORIES,
};

const migrateCategories = (categories?: string[]) => {
  const source = categories?.length ? categories : DEFAULT_CATEGORIES;
  const migrated = source.flatMap(category => (category === '餐饮' ? ['餐费', '饮料'] : [category]));
  const unique = Array.from(new Set(migrated.filter(Boolean)));
  const required = ['零食', '水果', 'AI服务', '交费', '维修'];
  const withoutRequired = unique.filter(category => !required.includes(category));
  const otherIndex = withoutRequired.indexOf('其他');
  if (otherIndex >= 0) {
    return [...withoutRequired.slice(0, otherIndex), ...required, ...withoutRequired.slice(otherIndex)];
  }
  return [...withoutRequired, ...required];
};

const migrateTransactions = (transactions: Transaction[]) =>
  transactions.filter(item => !SEED_ID_PATTERN.test(item.id));

export interface RecoveryState { reason: string; rawTransactions?: string | null; rawSettings?: string | null }
let recoveryState: RecoveryState | null = null;

class LedgerReadError extends Error {}

const failRead = (reason: string): never => {
  recoveryState = { reason, rawTransactions: localStorage.getItem(TRANSACTIONS_KEY), rawSettings: localStorage.getItem(SETTINGS_KEY) };
  throw new LedgerReadError(reason);
};

const normalizeSettings = (settings: AppSettings): AppSettings => ({
  ...DEFAULT_SETTINGS,
  ...settings,
  aiMode: settings.aiMode === 'cloud' ? 'cloud' : 'custom',
  baseUrl: LEGACY_MODEL_PATTERN.test(settings.baseUrl) ? DEFAULT_SETTINGS.baseUrl : settings.baseUrl || DEFAULT_SETTINGS.baseUrl,
  // Cloud proxy is a product endpoint, not a user-editable model setting.
  cloudBaseUrl: DEFAULT_SETTINGS.cloudBaseUrl,
  model: LEGACY_MODEL_PATTERN.test(settings.model) ? DEFAULT_SETTINGS.model : settings.model || DEFAULT_SETTINGS.model,
  categories: migrateCategories(settings.categories),
});

const readLedger = () => {
  if (recoveryState) throw new LedgerReadError(recoveryState.reason);
  const rawTransactions = localStorage.getItem(TRANSACTIONS_KEY);
  const rawSettings = localStorage.getItem(SETTINGS_KEY);
  let transactions: Transaction[] = [];
  let settings: AppSettings = DEFAULT_SETTINGS;
  try {
    transactions = rawTransactions ? JSON.parse(rawTransactions) : [];
    if (!Array.isArray(transactions)) failRead('账本结构不是交易列表');
    settings = normalizeSettings(rawSettings ? ({ ...DEFAULT_SETTINGS, ...JSON.parse(rawSettings) } as AppSettings) : DEFAULT_SETTINGS);
  } catch (error) {
    if (error instanceof LedgerReadError) throw error;
    failRead('本地账本或设置无法解析，已停止写入以保护原始数据');
  }
  const migrated = migrateTransactions(transactions);
  const payload = { schemaVersion: CURRENT_SCHEMA_VERSION, transactions: migrated, settings: { categories: settings.categories, monthlyBudget: settings.monthlyBudget } };
  const manifestRaw = localStorage.getItem(MANIFEST_KEY);
  if (manifestRaw) {
    try {
      const manifest = JSON.parse(manifestRaw) as { checksum?: string; schemaVersion?: number };
      if (manifest.schemaVersion === CURRENT_SCHEMA_VERSION && manifest.checksum !== checksum(payload)) failRead('账本校验和不匹配，数据可能已损坏');
    } catch (error) {
      if (error instanceof LedgerReadError) throw error;
      failRead('账本校验信息无法解析，已停止写入以保护原始数据');
    }
  }
  if (!manifestRaw || rawTransactions !== JSON.stringify(migrated) || localStorage.getItem(SCHEMA_KEY) !== String(CURRENT_SCHEMA_VERSION)) {
    localStorage.setItem(RECOVERY_KEY, JSON.stringify({ rawTransactions, rawSettings, createdAt: new Date().toISOString() }));
    commitLedger(migrated, settings);
  }
  return { transactions: migrated, settings };
};

const commitLedger = (transactions: Transaction[], settings: AppSettings) => {
  const normalized = normalizeSettings(settings);
  const payload = { schemaVersion: CURRENT_SCHEMA_VERSION, transactions, settings: { categories: normalized.categories, monthlyBudget: normalized.monthlyBudget } };
  localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(transactions));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  localStorage.setItem(SCHEMA_KEY, String(CURRENT_SCHEMA_VERSION));
  localStorage.setItem(MANIFEST_KEY, JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, checksum: checksum(payload), updatedAt: new Date().toISOString() }));
};

const backupBeforeWrite = (transactions: Transaction[], settings: AppSettings) => {
  const backup = createBackup(transactions, settings, CURRENT_SCHEMA_VERSION);
  localStorage.setItem(RECOVERY_KEY, JSON.stringify(backup));
  void saveAutomaticBackup(backup).catch(() => undefined);
};

export const storage = {
  getRecoveryState(): RecoveryState | null {
    try { readLedger(); } catch { /* state is set by readLedger */ }
    return recoveryState;
  },

  getRecoveryRaw() { return JSON.stringify(recoveryState ?? { reason: '没有恢复数据' }, null, 2); },

  getTransactions(): Transaction[] { return readLedger().transactions; },

  saveTransaction(transaction: Omit<Transaction, 'id'> & { id?: string }) {
    const { transactions: list, settings } = readLedger();
    const next: Transaction = {
      ...transaction,
      id: transaction.id ?? crypto.randomUUID(),
    };
    const index = list.findIndex(item => item.id === next.id);
    const updated = index >= 0 ? list.map(item => (item.id === next.id ? next : item)) : [next, ...list];
    backupBeforeWrite(list, settings);
    commitLedger(updated, settings);
    return next;
  },

  deleteTransaction(id: string) {
    const { transactions, settings } = readLedger();
    backupBeforeWrite(transactions, settings);
    commitLedger(transactions.filter(item => item.id !== id), settings);
  },

  deleteTransactions(ids: string[]) {
    const idSet = new Set(ids);
    const { transactions, settings } = readLedger();
    backupBeforeWrite(transactions, settings);
    commitLedger(transactions.filter(item => !idSet.has(item.id)), settings);
  },

  getSettings(): AppSettings {
    return readLedger().settings;
  },

  saveSettings(settings: AppSettings) {
    const { transactions, settings: current } = readLedger();
    backupBeforeWrite(transactions, current);
    commitLedger(transactions, settings);
  },

  getCloudSession(): CloudSession | null {
    try {
      const raw = localStorage.getItem(CLOUD_SESSION_KEY);
      return raw ? (JSON.parse(raw) as CloudSession) : null;
    } catch {
      return null;
    }
  },

  saveCloudSession(session: CloudSession | null) {
    if (!session) {
      localStorage.removeItem(CLOUD_SESSION_KEY);
      return;
    }
    localStorage.setItem(CLOUD_SESSION_KEY, JSON.stringify(session));
  },

  getDeviceId() {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  },

  createBackup(): LedgerBackup {
    const { transactions, settings } = readLedger();
    return createBackup(transactions, settings, CURRENT_SCHEMA_VERSION);
  },

  restoreBackup(backup: LedgerBackup, mode: 'replace' | 'merge') {
    const current = recoveryState ? { transactions: [] as Transaction[], settings: DEFAULT_SETTINGS } : readLedger();
    const { transactions, settings } = current;
    if (recoveryState) localStorage.setItem(RECOVERY_KEY, JSON.stringify(recoveryState));
    else backupBeforeWrite(transactions, settings);
    const imported = backup.payload.transactions as Transaction[];
    const next = mode === 'replace' ? imported : [...transactions, ...imported.filter(item => !transactions.some(existing => existing.id === item.id))];
    commitLedger(next, { ...settings, categories: backup.payload.settings.categories, monthlyBudget: backup.payload.settings.monthlyBudget });
    recoveryState = null;
    return next.length;
  },

  resetAll() {
    localStorage.removeItem(TRANSACTIONS_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(SCHEMA_KEY);
    localStorage.removeItem(CLOUD_SESSION_KEY);
    localStorage.removeItem(MANIFEST_KEY);
    localStorage.removeItem(RECOVERY_KEY);
    recoveryState = null;
  },
};
