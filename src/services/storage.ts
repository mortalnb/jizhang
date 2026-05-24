import { DEFAULT_CATEGORIES } from '../data/categories';
import type { AppSettings, Transaction } from '../types';
import { todayISO } from './date';

const TRANSACTIONS_KEY = 'ab_transactions';
const SETTINGS_KEY = 'ab_settings';
const SCHEMA_KEY = 'ab_schema_version';

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  monthlyBudget: 3000,
  categories: DEFAULT_CATEGORIES,
};

const daysAgo = (days: number) => {
  const date = new Date(todayISO());
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
};

const createSeedTransactions = (): Transaction[] => [
  { id: 'seed-001', amount: 25, category: '餐饮', date: daysAgo(0), paymentMethod: '微信支付', description: '麦当劳午餐' },
  { id: 'seed-002', amount: 15, category: '交通', date: daysAgo(0), paymentMethod: '支付宝', description: '打车回家' },
  { id: 'seed-003', amount: 89, category: '餐饮', date: daysAgo(1), paymentMethod: '支付宝', description: '盒马鲜生面包零食', tag: '#盒马周购' },
  { id: 'seed-004', amount: 61, category: '日用', date: daysAgo(1), paymentMethod: '支付宝', description: '盒马鲜生纸巾洗护', tag: '#盒马周购' },
  { id: 'seed-005', amount: 49, category: '日用', date: daysAgo(2), paymentMethod: '微信支付', description: '生活用品补给' },
  { id: 'seed-006', amount: 199, category: '服饰', date: daysAgo(7), paymentMethod: '微信支付', description: '优衣库 T 恤' },
  { id: 'seed-007', amount: 38, category: '交通', date: daysAgo(9), paymentMethod: '支付宝', description: '雨天网约车' },
  { id: 'seed-008', amount: 99, category: '娱乐', date: daysAgo(15), paymentMethod: '微信支付', description: '游戏道具充值' },
  { id: 'seed-009', amount: 899, category: '数码', date: daysAgo(85), paymentMethod: '支付宝', description: '降噪耳机' },
];

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
  categories: settings.categories?.length ? settings.categories : DEFAULT_CATEGORIES,
});

export const storage = {
  getTransactions(): Transaction[] {
    const raw = localStorage.getItem(TRANSACTIONS_KEY);
    if (!raw) {
      const seed = createSeedTransactions();
      localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(seed));
      localStorage.setItem(SCHEMA_KEY, '1');
      return seed;
    }

    try {
      return JSON.parse(raw) as Transaction[];
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
