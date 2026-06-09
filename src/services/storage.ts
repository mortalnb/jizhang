import { DEFAULT_CATEGORIES } from '../data/categories';
import type { AppSettings, CloudSession, Transaction } from '../types';

const TRANSACTIONS_KEY = 'ab_transactions';
const SETTINGS_KEY = 'ab_settings';
const SCHEMA_KEY = 'ab_schema_version';
const CLOUD_SESSION_KEY = 'ab_cloud_session';
const DEVICE_ID_KEY = 'ab_device_id';
const CURRENT_SCHEMA_VERSION = '2';
const SEED_ID_PATTERN = /^seed-00[1-9]$/;
const LEGACY_MODEL_PATTERN = new RegExp(['deep', 'seek'].join(''), 'i');

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  baseUrl: 'https://api.xiaomimimo.com',
  cloudBaseUrl: import.meta.env.VITE_CLOUD_BASE_URL || '',
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

const readJSON = <T,>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return value ? ({ ...fallback, ...JSON.parse(value) } as T) : fallback;
  } catch {
    return fallback;
  }
};

const normalizeSettings = (settings: AppSettings): AppSettings => ({
  ...DEFAULT_SETTINGS,
  ...settings,
  baseUrl: LEGACY_MODEL_PATTERN.test(settings.baseUrl) ? DEFAULT_SETTINGS.baseUrl : settings.baseUrl || DEFAULT_SETTINGS.baseUrl,
  cloudBaseUrl: settings.cloudBaseUrl?.trim() || DEFAULT_SETTINGS.cloudBaseUrl,
  model: LEGACY_MODEL_PATTERN.test(settings.model) ? DEFAULT_SETTINGS.model : settings.model || DEFAULT_SETTINGS.model,
  categories: migrateCategories(settings.categories),
});

export const storage = {
  getTransactions(): Transaction[] {
    const raw = localStorage.getItem(TRANSACTIONS_KEY);
    if (!raw) {
      localStorage.setItem(SCHEMA_KEY, CURRENT_SCHEMA_VERSION);
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as Transaction[];
      const migrated = migrateTransactions(parsed);
      if (migrated.length !== parsed.length || localStorage.getItem(SCHEMA_KEY) !== CURRENT_SCHEMA_VERSION) {
        localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(migrated));
        localStorage.setItem(SCHEMA_KEY, CURRENT_SCHEMA_VERSION);
      }
      return migrated;
    } catch {
      return [];
    }
  },

  saveTransaction(transaction: Omit<Transaction, 'id'> & { id?: string }) {
    const list = this.getTransactions();
    const next: Transaction = {
      ...transaction,
      id: transaction.id ?? crypto.randomUUID(),
    };
    const index = list.findIndex(item => item.id === next.id);
    const updated = index >= 0 ? list.map(item => (item.id === next.id ? next : item)) : [next, ...list];
    localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(updated));
    return next;
  },

  deleteTransaction(id: string) {
    const updated = this.getTransactions().filter(item => item.id !== id);
    localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(updated));
  },

  deleteTransactions(ids: string[]) {
    const idSet = new Set(ids);
    const updated = this.getTransactions().filter(item => !idSet.has(item.id));
    localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(updated));
  },

  getSettings(): AppSettings {
    const raw = readJSON<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS);
    const normalized = normalizeSettings(raw);
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    }
    return normalized;
  },

  saveSettings(settings: AppSettings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
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

  resetAll() {
    localStorage.removeItem(TRANSACTIONS_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(SCHEMA_KEY);
    localStorage.removeItem(CLOUD_SESSION_KEY);
  },
};
