import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');

const categories = read('src/data/categories.ts');
const storage = read('src/services/storage.ts');
const aiParser = read('src/services/aiParser.ts');
const transactionList = read('src/components/TransactionList.tsx');
const app = read('src/App.tsx');
const androidBuild = read('android/app/build.gradle');
const packageJson = JSON.parse(read('package.json'));

for (const category of ['零食', '水果', 'AI服务']) {
  assert.match(categories, new RegExp(`'${category}'`), `default categories should include ${category}`);
  assert.match(storage, new RegExp(`'${category}'`), `settings migration should include ${category}`);
}

for (const example of [
  '我付了 120，他转我 60',
  '3 个人吃饭花了 300，是 AA 的',
  '两人吃饭 163，我付的，他只转我 80',
]) {
  assert.match(aiParser, new RegExp(example.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `AI prompt should include example: ${example}`);
}

assert.match(aiParser, /AA.*splitItems|splitItems.*AA/s, 'AI prompt should explain AA splitItems behavior');
assert.match(transactionList, /编辑/, 'transaction details should expose an edit action');
assert.match(transactionList, /overflow-y-auto/, 'long transaction details should be scrollable');
assert.match(storage, /rawTransactions \? JSON\.parse\(rawTransactions\) : \[\]/, 'new users should start with an empty transaction list');
assert.match(storage, /const migrated = migrateTransactions\(transactions\)/, 'existing transactions should be migrated instead of replaced');
assert.equal(packageJson.version, '1.5.0-rc.1', 'package version should be the RC version');
assert.match(app, /v1\.5\.0-rc\.1/, 'app header should show the RC version');
assert.match(androidBuild, /versionCode 16/, 'Android versionCode should be 16');
assert.match(androidBuild, /versionName "1\.5\.0-rc\.1"/, 'Android versionName should be the RC version');
assert.match(storage, /CURRENT_SCHEMA_VERSION = 4/, 'storage schema should be versioned');
assert.match(storage, /getRecoveryState/, 'storage should expose read-only recovery state');
assert.match(storage, /aiMode: 'custom'/, 'self-managed key should remain the safe default mode');
assert.match(storage, /saveTransactions/, 'storage should support atomic batch writes');
assert.match(storage, /cloudSyncEnabled: false/, 'cloud sync should remain opt-in');
assert.match(aiParser, /绝不能把跨日期金额相加成一笔/, 'batch prompt should forbid cross-date aggregation');

console.log('Feature contracts verified.');
