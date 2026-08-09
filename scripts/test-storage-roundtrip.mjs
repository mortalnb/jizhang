import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createServer } from 'vite';

class MemoryStorage {
  #values = new Map();
  clear() { this.#values.clear(); }
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  removeItem(key) { this.#values.delete(key); }
  setItem(key, value) { this.#values.set(key, String(value)); }
}

globalThis.crypto ??= webcrypto;
globalThis.localStorage = new MemoryStorage();
globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
globalThis.window = { dispatchEvent() {} };

const vite = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } });
try {
  const { checksum, createBackup, parseBackup } = await vite.ssrLoadModule('/src/services/backup.ts');
  const { DEFAULT_SETTINGS, storage } = await vite.ssrLoadModule('/src/services/storage.ts');

  storage.resetAll();
  const saved = storage.saveTransactions([
    { amount: 18, category: '饮料', date: '2026-08-01', paymentMethod: '', description: '咖啡', detail: undefined },
    { amount: 3, category: '交通', date: '2026-08-02', paymentMethod: '', description: '地铁', tag: undefined },
  ]);
  assert.equal(saved.length, 2);
  assert.equal(storage.getTransactions().length, 2, 'batch save must survive the next integrity read');
  assert.equal(storage.getRecoveryState(), null, 'valid JSON roundtrip must not enter recovery mode');

  const exported = JSON.stringify(createBackup(storage.getTransactions(), storage.getSettings(), 4));
  assert.equal(parseBackup(exported).payload.transactions.length, 2, 'serialized backup must verify');

  storage.resetAll();
  const legacyTransactions = [{ id: 'legacy-1', amount: 9, category: '其他', date: '2026-08-01', paymentMethod: '', description: '旧账' }];
  localStorage.setItem('ab_transactions', JSON.stringify(legacyTransactions));
  localStorage.setItem('ab_settings', JSON.stringify(DEFAULT_SETTINGS));
  localStorage.setItem('ab_schema_version', '3');
  localStorage.setItem('ab_integrity_manifest', JSON.stringify({ schemaVersion: 3, checksum: 'fnv1a-deadbeef' }));
  assert.equal(storage.getTransactions().length, 1, 'schema 3 ledger should migrate instead of false corruption');
  assert.equal(JSON.parse(localStorage.getItem('ab_integrity_manifest')).schemaVersion, 4);

  const payload = storage.getLedgerPayload();
  assert.equal(checksum(payload), checksum(JSON.parse(JSON.stringify(payload))), 'checksum must be JSON stable');
  assert.throws(
    () => storage.restoreCloudPayload({ ...payload, schemaVersion: 5 }),
    /更高版本/,
    'future cloud schema must not overwrite a current client',
  );
  assert.equal(storage.getTransactions().length, 1, 'rejected cloud restore must leave the local ledger intact');
  console.log('Storage roundtrip, atomic batch write, schema-3 migration, and cloud-restore guard verified.');
} finally {
  await vite.close();
}
