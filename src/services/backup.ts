import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { AppSettings, Transaction } from '../types';

export interface LedgerBackup {
  backupVersion: 1;
  createdAt: string;
  checksum: string;
  payload: {
    schemaVersion: number;
    settings: Pick<AppSettings, 'categories' | 'monthlyBudget'>;
    transactions: Transaction[];
  };
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

// Detects accidental corruption. It is not a cryptographic signature.
export const checksum = (value: unknown) => {
  let hash = 0x811c9dc5;
  for (const char of stable(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const createBackup = (transactions: Transaction[], settings: AppSettings, schemaVersion: number): LedgerBackup => {
  const payload = {
    schemaVersion,
    settings: { categories: settings.categories, monthlyBudget: settings.monthlyBudget },
    transactions,
  };
  return { backupVersion: 1, createdAt: new Date().toISOString(), checksum: checksum(payload), payload };
};

export const parseBackup = (raw: string): LedgerBackup => {
  const backup = JSON.parse(raw) as LedgerBackup;
  if (backup.backupVersion !== 1 || !backup.payload || !Array.isArray(backup.payload.transactions) || !backup.payload.settings) {
    throw new Error('备份格式不受支持');
  }
  if (backup.checksum !== checksum(backup.payload)) throw new Error('备份校验失败，文件可能已损坏');
  return backup;
};

const filename = (kind: 'manual' | 'auto') => `智能记账备份/${kind === 'auto' ? '自动备份-latest' : `账本-${new Date().toISOString().slice(0, 10)}`}.json`;

export const saveAutomaticBackup = async (backup: LedgerBackup) => {
  if (!Capacitor.isNativePlatform()) return false;
  await Filesystem.writeFile({ path: filename('auto'), data: JSON.stringify(backup, null, 2), directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
  return true;
};

export const exportBackup = async (backup: LedgerBackup) => {
  const data = JSON.stringify(backup, null, 2);
  if (Capacitor.isNativePlatform()) {
    const saved = await Filesystem.writeFile({ path: filename('manual'), data, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
    if ((await Share.canShare()).value) await Share.share({ title: '导出智能记账账本', files: [saved.uri] });
    return;
  }
  const blob = new Blob([data], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename('manual').split('/').at(-1) ?? '智能记账备份.json';
  link.click();
  URL.revokeObjectURL(link.href);
};
