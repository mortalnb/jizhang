import { DEFAULT_CATEGORIES } from '../data/categories';
import type { AppSettings, Transaction } from '../types';

const TRANSACTIONS_KEY = 'ab_transactions';
const SETTINGS_KEY = 'ab_settings';
const SCHEMA_KEY = 'ab_schema_version';
const CURRENT_SCHEMA_VERSION = '2';
const SEED_ID_PATTERN = /^seed-00[1-9]$/;

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  monthlyBudget: 3000,
  categories: DEFAULT_CATEGORIES,
};

const migrateCategories = (categories?: string[]) => {
  const source = categories?.length ? categories : DEFAULT_CATEGORIES;
  const migrated = source.flatMap(category => (category === '餐饮' ? ['餐费', '饮料'] : [category]));
  const unique = Array.from(new Set(migrated.filter(Boolean)));
  const withoutRequired = unique.filter(category => category !== '交费' && category !== '维修');
  const otherIndex = withoutRequired.indexOf('其他');
  const required = ['交费', '维修'];
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
    return normalizeSettings(readJSON<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS));
  },

  saveSettings(settings: AppSettings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
  },

  resetAll() {
    localStorage.removeItem(TRANSACTIONS_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(SCHEMA_KEY);
  },
};
