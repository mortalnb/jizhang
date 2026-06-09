import type { AppSettings, CloudSession, ParsedTransaction } from '../types';
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
  paymentMethod?: string;
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
}

const cloudUrl = (settings: Pick<AppSettings, 'cloudBaseUrl'>, path: string) => `${settings.cloudBaseUrl.replace(/\/$/, '')}${path}`;

const cloudFetch = async <T>(settings: Pick<AppSettings, 'cloudBaseUrl'>, path: string, body?: unknown): Promise<T> => {
  const session = storage.getCloudSession();
  if (!session?.accessToken) throw new Error('Cloud session is not available');
  const response = await fetch(cloudUrl(settings, path), {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = payload?.error?.message || `Cloud API HTTP ${response.status}`;
    throw new Error(message);
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
    await cloudFetch(settings, '/api/auth/logout', {}).catch(() => undefined);
    storage.saveCloudSession(null);
  },

  me(settings: Pick<AppSettings, 'cloudBaseUrl'>) {
    return cloudFetch<{ entitlement: CloudSession['entitlement']; user: CloudSession['user'] }>(settings, '/api/me');
  },

  async parseTransaction(settings: Pick<AppSettings, 'cloudBaseUrl' | 'model'>, text: string, categories: string[]) {
    const payload = await cloudFetch<CloudResult<Partial<ParsedTransaction>>>(settings, '/api/model/parse-transaction', {
      categories,
      model: settings.model,
      text,
    });
    return payload.result;
  },

  async recognizeBillImage(settings: Pick<AppSettings, 'cloudBaseUrl' | 'model'>, imageDataUrl: string, categories: string[]) {
    const payload = await cloudFetch<CloudResult<CloudVisionResult>>(settings, '/api/model/recognize-bill-image', {
      categories,
      imageDataUrl,
      model: settings.model,
    });
    return payload.result;
  },

  async testCapability(settings: Pick<AppSettings, 'cloudBaseUrl' | 'model'>) {
    const payload = await cloudFetch<CloudResult<{ json?: boolean; text?: boolean; vision?: boolean }>>(settings, '/api/model/test-capability', {
      model: settings.model,
    });
    return payload.result;
  },
};
