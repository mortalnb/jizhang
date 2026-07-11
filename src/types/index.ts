export interface Transaction {
  id: string;
  amount: number;
  category: string;
  date: string;
  paymentMethod: string;
  description: string;
  detail?: string;
  recognition?: {
    itemCount?: number;
    source?: string;
    warnings?: string[];
  };
  subItems?: SplitItem[];
  tag?: string;
}

export interface AppSettings {
  aiMode: 'cloud' | 'custom';
  apiKey: string;
  baseUrl: string;
  cloudBaseUrl: string;
  model: string;
  monthlyBudget: number;
  categories: string[];
}

export interface CloudSession {
  accessToken: string;
  entitlement?: {
    allowedModels: string[];
    canUseModelProxy: boolean;
    dailyLimit: number;
    expiresAt?: string | null;
    monthlyLimit: number;
  } | null;
  refreshToken?: string;
  user: {
    displayName?: string | null;
    id: string;
    isEnabled: boolean;
    username: string;
  };
}

export interface SplitItem {
  amount: number;
  category: string;
  description: string;
  detail?: string;
  quantity?: string;
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
