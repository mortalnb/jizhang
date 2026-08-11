import assert from 'node:assert/strict';
import fs from 'node:fs';
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
    { amount: 18, category: '饮料', date: '2026-08-01', description: '咖啡', detail: undefined },
    { amount: 3, category: '交通', date: '2026-08-02', description: '地铁', tag: undefined },
  ]);
  assert.equal(saved.length, 2);
  assert.equal(storage.getTransactions().length, 2, 'batch save must survive the next integrity read');
  assert.equal(storage.getRecoveryState(), null, 'valid JSON roundtrip must not enter recovery mode');

  const exported = JSON.stringify(createBackup(storage.getTransactions(), storage.getSettings(), 5));
  assert.equal(parseBackup(exported).payload.transactions.length, 2, 'serialized backup must verify');

  storage.resetAll();
  const legacyTransactions = [{ id: 'legacy-1', amount: 9, category: '其他', date: '2026-08-01', paymentMethod: '支付宝', description: '盒马旧账', tag: ['#盒马采购', '模型噪声'] }];
  localStorage.setItem('ab_transactions', JSON.stringify(legacyTransactions));
  localStorage.setItem('ab_settings', JSON.stringify(DEFAULT_SETTINGS));
  localStorage.setItem('ab_schema_version', '3');
  localStorage.setItem('ab_integrity_manifest', JSON.stringify({ schemaVersion: 3, checksum: 'fnv1a-deadbeef' }));
  assert.equal(storage.getTransactions().length, 1, 'schema 3 ledger should migrate instead of false corruption');
  assert.equal(storage.getTransactions()[0].tag, '超市采购', 'legacy arrays should reduce to one canonical scenario tag');
  assert.equal(storage.getTransactions()[0].merchant, '盒马', 'explicit merchant names may be indexed without changing the original description');
  assert.equal(Object.hasOwn(storage.getTransactions()[0], 'paymentMethod'), false, 'schema 5 should drop the legacy payment field');
  assert.equal(storage.getTransactions()[0].amount, 9, 'migration must preserve the original amount');
  assert.equal(storage.getTransactions()[0].date, '2026-08-01', 'migration must preserve the original date');
  assert.equal(storage.getTransactions()[0].description, '盒马旧账', 'migration must preserve the original description');
  assert.equal(JSON.parse(localStorage.getItem('ab_integrity_manifest')).schemaVersion, 5);

  const payload = storage.getLedgerPayload();
  assert.equal(checksum(payload), checksum(JSON.parse(JSON.stringify(payload))), 'checksum must be JSON stable');
  assert.throws(
    () => storage.restoreCloudPayload({ ...payload, schemaVersion: 6 }),
    /更高版本/,
    'future cloud schema must not overwrite a current client',
  );
  assert.equal(storage.getTransactions().length, 1, 'rejected cloud restore must leave the local ledger intact');

  storage.saveSettings({ ...storage.getSettings(), monthlyBudget: 4321 });
  const olderBackup = createBackup([
    { id: 'legacy-1', amount: 8, category: '其他', date: '2026-08-01', description: '较旧同 ID 记录' },
    { id: 'legacy-2', amount: 6, category: '交通', date: '2026-07-31', description: '备份缺失记录' },
  ], { ...storage.getSettings(), monthlyBudget: 999 }, 3);
  assert.equal(storage.restoreBackup(olderBackup, 'merge'), 2, 'merge import should add only missing IDs');
  assert.equal(storage.getTransactions().find(transaction => transaction.id === 'legacy-1').amount, 9, 'merge import must keep the current version of a duplicate ID');
  assert.equal(storage.getSettings().monthlyBudget, 4321, 'merge import must preserve current settings instead of restoring older settings');
  const cloudMergeCount = storage.mergeCloudPayload({
    schemaVersion: 5,
    settings: { categories: [...storage.getSettings().categories, '旅行'], monthlyBudget: 100 },
    transactions: [
      { id: 'legacy-1', amount: 1, category: '其他', date: '2026-08-01', description: '云端较旧同 ID 记录' },
      { id: 'cloud-only', amount: 12, category: '交通', date: '2026-08-03', description: '云端独有记录' },
    ],
  });
  assert.equal(cloudMergeCount, 3, 'cloud merge should add only cloud-only IDs');
  assert.equal(storage.getTransactions().find(transaction => transaction.id === 'legacy-1').amount, 9, 'cloud merge must keep the local version of a duplicate ID');
  assert.equal(storage.getSettings().monthlyBudget, 4321, 'cloud merge must keep the local budget');

  const externalFixture = process.env.LEDGER_FIXTURE;
  if (externalFixture) {
    const backup = parseBackup(fs.readFileSync(externalFixture, 'utf8'));
    storage.resetAll();
    const restoredCount = storage.restoreBackup(backup, 'replace');
    assert.equal(restoredCount, backup.payload.transactions.length, 'external backup should restore every transaction');
    assert.equal(storage.getTransactions().length, restoredCount, 'external backup should survive an integrity read');
    assert.equal(storage.getTransactions().every(transaction => transaction.tag === undefined || typeof transaction.tag === 'string'), true, 'external legacy tags should normalize to strings');
    assert.equal(storage.getTransactions().every(transaction => transaction.tag === undefined || (!transaction.tag.startsWith('#') && !/[,，;；|/]/.test(transaction.tag))), true, 'external tags should be at most one canonical value');
    assert.equal(storage.getTransactions().every(transaction => (transaction.subItems ?? []).every(item => !Object.hasOwn(item, 'tag'))), true, 'schema 5 should keep the single scenario tag only on the parent transaction');
    assert.equal(storage.getTransactions().every(transaction => !Object.hasOwn(transaction, 'paymentMethod')), true, 'external legacy payment fields should not persist in schema 5');
    assert.equal(storage.getRecoveryState(), null, 'external backup should not enter recovery mode');
    console.log(`External backup import verified (${restoredCount} transactions; schema ${backup.payload.schemaVersion}).`);
  }
  console.log('Storage roundtrip, atomic batch write, schema-5 migration, and cloud-restore guard verified.');
} finally {
  await vite.close();
}
