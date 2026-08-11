export interface Transaction {
  id: string;
  amount: number;
  category: string;
  date: string;
  description: string;
  detail?: string;
  recognition?: {
    itemCount?: number;
    source?: string;
    warnings?: string[];
  };
  subItems?: SplitItem[];
  tag?: string;
  batchId?: string;
  merchant?: string;
  orderId?: string;
}

export interface AppSettings {
  aiMode: 'cloud' | 'custom';
  apiKey: string;
  baseUrl: string;
  cloudBaseUrl: string;
  model: string;
  monthlyBudget: number;
  categories: string[];
  cloudSyncEnabled: boolean;
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
}

export interface ParsedTransaction {
  amount: number;
  category: string;
  description: string;
  detail?: string;
  date: string;
  tag?: string;
  splitItems?: SplitItem[];
  merchant?: string;
  orderId?: string;
  grouping?: 'folded' | 'separate';
}

export interface ParsedBatch {
  transactions: ParsedTransaction[];
  warnings?: string[];
}

export interface LedgerPayload {
  schemaVersion: number;
  settings: Pick<AppSettings, 'categories' | 'monthlyBudget'>;
  transactions: Transaction[];
}

export interface CloudLedgerSnapshot {
  checksum: string;
  payload: LedgerPayload;
  revision: number;
  updatedAt: string;
}

export interface CloudSyncState {
  error?: string;
  lastSyncedAt?: string;
  revision: number;
  status: 'disabled' | 'idle' | 'syncing' | 'conflict' | 'error';
}

export type Tab = 'dashboard' | 'input' | 'transactions' | 'settings';
