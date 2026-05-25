export interface Transaction {
  id: string;
  amount: number;
  category: string;
  date: string;
  paymentMethod: string;
  description: string;
  detail?: string;
  tag?: string;
}

export interface AppSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  monthlyBudget: number;
  categories: string[];
}

export interface SplitItem {
  amount: number;
  category: string;
  description: string;
  detail?: string;
  tag?: string;
}

export interface ParsedTransaction {
  amount: number;
  category: string;
  paymentMethod: string;
  description: string;
  detail?: string;
  date: string;
  tag?: string;
  splitItems?: SplitItem[];
}

export type Tab = 'dashboard' | 'input' | 'transactions' | 'settings';
