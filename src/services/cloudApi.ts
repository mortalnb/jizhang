import type { AppSettings, CloudLedgerSnapshot, CloudSession, LedgerPayload, ParsedBatch, ParsedTransaction } from '../types';
import { storage } from './storage';

interface CloudResult<T> {
  result: T;
}

export interface CloudVisionResult {
  amount?: number | string;
  category?: string;
  date?: string;
  description?: string;
  detail?: string;
  merchant?: string;
  orderId?: string;
  source?: string;
  sourceLabel?: string;
  splitItems?: Array<{
    amount?: number | string;
    category?: string;
    description?: string;
    detail?: string;
    quantity?: string;
    tag?: string;
  }>;
  tag?: string;
  transactions?: CloudVisionResult[];
  warnings?: string[];
}

const cloudUrl = (settings: Pick<AppSettings, 'cloudBaseUrl'>, path: string) => `${settings.cloudBaseUrl.replace(/\/$/, '')}${path}`;

export class CloudApiError extends Error {
  status: number;
  payload?: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = 'CloudApiError';
    this.status = status;
    this.payload = payload;
  }
}

interface CloudFetchOptions {
  body?: unknown;
  method?: 'GET' | 'POST' | 'PUT';
}

const cloudFetch = async <T>(settings: Pick<AppSettings, 'cloudBaseUrl'>, path: string, options: CloudFetchOptions = {}, retried = false): Promise<T> => {
  const session = storage.getCloudSession();
  if (!session?.accessToken) throw new Error('Cloud session is not available');
  const response = await fetch(cloudUrl(settings, path), {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 401 && !retried && session.refreshToken) {
    const refreshed = await cloudApi.refresh(settings, session.refreshToken);
    storage.saveCloudSession({ ...session, ...refreshed });
    return cloudFetch(settings, path, options, true);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = payload?.error?.message || `Cloud API HTTP ${response.status}`;
    throw new CloudApiError(message, response.status, payload);
  }
  return (await response.json()) as T;
};

export const cloudApi = {
  async login(settings: Pick<AppSettings, 'cloudBaseUrl'>, username: string, password: string) {
    const response = await fetch(cloudUrl(settings, '/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: storage.getDeviceId(),
        deviceLabel: navigator.userAgent.slice(0, 120),
        password,
        username,
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error?.message || `Cloud login HTTP ${response.status}`);
    }
    const session = (await response.json()) as CloudSession;
    storage.saveCloudSession(session);
    return session;
  },

  async logout(settings: Pick<AppSettings, 'cloudBaseUrl'>) {
    await cloudFetch(settings, '/api/auth/logout', { body: {} }).catch(() => undefined);
    storage.saveCloudSession(null);
  },

  async refresh(settings: Pick<AppSettings, 'cloudBaseUrl'>, refreshToken: string) {
    const response = await fetch(cloudUrl(settings, '/api/auth/refresh'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: storage.getDeviceId(), refreshToken }),
    });
    if (!response.ok) throw new Error('云端会话已失效，请重新登录');
    return (await response.json()) as Pick<CloudSession, 'accessToken' | 'refreshToken'>;
  },

  me(settings: Pick<AppSettings, 'cloudBaseUrl'>) {
    return cloudFetch<{ entitlement: CloudSession['entitlement']; user: CloudSession['user'] }>(settings, '/api/me');
  },

  async parseTransaction(settings: Pick<AppSettings, 'cloudBaseUrl' | 'model'>, text: string, categories: string[]) {
    const payload = await cloudFetch<CloudResult<ParsedBatch | Partial<ParsedTransaction>>>(settings, '/api/model/parse-transaction', {
      body: {
        categories,
        model: settings.model,
        text,
      },
    });
    return payload.result;
  },

  async recognizeBillImage(settings: Pick<AppSettings, 'cloudBaseUrl' | 'model'>, imageDataUrl: string, categories: string[]) {
    const payload = await cloudFetch<CloudResult<CloudVisionResult>>(settings, '/api/model/recognize-bill-image', {
      body: {
        categories,
        imageDataUrl,
        model: settings.model,
      },
    });
    return payload.result;
  },

  async testCapability(settings: Pick<AppSettings, 'cloudBaseUrl' | 'model'>) {
    const payload = await cloudFetch<CloudResult<{ audio?: boolean; json?: boolean; text?: boolean; vision?: boolean }>>(settings, '/api/model/test-capability', {
      body: { model: settings.model },
    });
    return payload.result;
  },

  async transcribeAudio(settings: Pick<AppSettings, 'cloudBaseUrl'>, audioDataUrl: string, durationSeconds: number) {
    const payload = await cloudFetch<CloudResult<{ text: string }>>(settings, '/api/model/transcribe-audio', {
      body: { audioDataUrl, durationSeconds, language: 'zh', model: 'mimo-v2.5-asr' },
    });
    return payload.result.text;
  },

  async analyzeLedger(
    settings: Pick<AppSettings, 'cloudBaseUrl' | 'model'>,
    input: { financialFacts: unknown; model: string; monthSummaries: unknown[]; recentTransactions: unknown[]; requirements: string[] },
  ) {
    const payload = await cloudFetch<CloudResult<{ insights: Array<{ body: string; title: string; tone: 'info' | 'warn' | 'success' }> }>>(settings, '/api/model/analyze-ledger', { body: input });
    return payload.result;
  },

  getLedgerSnapshot(settings: Pick<AppSettings, 'cloudBaseUrl'>) {
    return cloudFetch<{ snapshot: CloudLedgerSnapshot | null }>(settings, '/api/ledger-snapshot');
  },

  putLedgerSnapshot(
    settings: Pick<AppSettings, 'cloudBaseUrl'>,
    input: { checksum: string; expectedRevision: number; payload: LedgerPayload },
  ) {
    return cloudFetch<{ snapshot: CloudLedgerSnapshot }>(settings, '/api/ledger-snapshot', { body: input, method: 'PUT' });
  },
};
