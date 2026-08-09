import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { AppSettings, LedgerPayload, Transaction } from '../types';

export interface LedgerBackup {
  backupVersion: 1 | 2;
  createdAt: string;
  checksum: string;
  payload: LedgerPayload;
  recoveredLegacyChecksum?: boolean;
}

const stableNormalized = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableNormalized).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableNormalized(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

// Match the value that is actually persisted by JSON.stringify: object keys with
// undefined values disappear and undefined array entries become null.
export const canonicalJsonValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const stable = (value: unknown) => stableNormalized(canonicalJsonValue(value));

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
  const payload = canonicalJsonValue({
    schemaVersion,
    settings: { categories: settings.categories, monthlyBudget: settings.monthlyBudget },
    transactions,
  } satisfies LedgerPayload);
  return { backupVersion: 2, createdAt: new Date().toISOString(), checksum: checksum(payload), payload };
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasValidShape = (backup: LedgerBackup) => {
  if (!isRecord(backup.payload) || !Array.isArray(backup.payload.transactions) || !isRecord(backup.payload.settings)) return false;
  if (!Array.isArray(backup.payload.settings.categories) || !backup.payload.settings.categories.every(category => typeof category === 'string')) return false;
  if (!Number.isFinite(Number(backup.payload.settings.monthlyBudget))) return false;
  return backup.payload.transactions.every(transaction =>
    isRecord(transaction) &&
    typeof transaction.id === 'string' &&
    typeof transaction.category === 'string' &&
    typeof transaction.date === 'string' &&
    Number.isFinite(Number(transaction.amount)),
  );
};

export const parseBackup = (raw: string): LedgerBackup => {
  const backup = JSON.parse(raw) as LedgerBackup;
  if (![1, 2].includes(backup.backupVersion) || !hasValidShape(backup)) {
    throw new Error('备份格式不受支持');
  }
  const expected = checksum(backup.payload);
  if (backup.checksum !== expected) {
    // v1 computed the checksum before JSON serialization, so optional undefined
    // fields could make an otherwise intact exported backup fail verification.
    if (backup.backupVersion !== 1) throw new Error('备份校验失败，文件可能已损坏');
    return { ...backup, backupVersion: 2, checksum: expected, payload: canonicalJsonValue(backup.payload), recoveredLegacyChecksum: true };
  }
  return { ...backup, backupVersion: 2, payload: canonicalJsonValue(backup.payload) };
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
