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
assert.match(storage, /if \(!raw\)[\s\S]*return \[\]/, 'new users should start with an empty transaction list');
assert.match(storage, /const migrated = migrateTransactions\(parsed\)/, 'existing transactions should be migrated instead of replaced');
assert.equal(packageJson.version, '1.4.1', 'package version should be 1.4.1');
assert.match(app, /v1\.4\.1/, 'app header should show v1.4.1');
assert.match(androidBuild, /versionCode 12/, 'Android versionCode should be 12');
assert.match(androidBuild, /versionName "1\.4\.1"/, 'Android versionName should be 1.4.1');

console.log('Feature contracts verified.');
