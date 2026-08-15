import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');

const categories = read('src/data/categories.ts');
const storage = read('src/services/storage.ts');
const aiParser = read('src/services/aiParser.ts');
const transactionList = read('src/components/TransactionList.tsx');
const aiInput = read('src/components/AIInput.tsx');
const app = read('src/App.tsx');
const analytics = read('src/services/ledgerAnalytics.ts');
const financialInsights = read('src/services/financialInsights.ts');
const serverRoutes = read('server/src/modelRoutes.ts');
const settings = read('src/components/Settings.tsx');
const cloudSync = read('src/services/cloudLedgerSync.ts');
const androidBuild = read('android/app/build.gradle');
const androidManifest = read('android/app/src/main/AndroidManifest.xml');
const voiceInput = read('src/services/voiceInput.ts');
const foldedCategories = read('src/services/foldedCategories.ts');
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
assert.equal(packageJson.version, '1.5.0-rc.4', 'package version should be the RC version');
assert.match(app, /v1\.5\.0-rc\.4/, 'app header should show the RC version');
assert.match(androidBuild, /versionCode 19/, 'Android versionCode should be 19');
assert.match(androidBuild, /versionName "1\.5\.0-rc\.4"/, 'Android versionName should be the RC version');
assert.match(androidManifest, /android\.permission\.RECORD_AUDIO/, 'Android should declare microphone capture permission');
assert.match(androidManifest, /android\.permission\.MODIFY_AUDIO_SETTINGS/, 'Capacitor WebView audio capture should declare its normal audio-settings permission');
assert.match(voiceInput, /系统设置 → 应用 → 记账 → 权限 → 麦克风/, 'permission denial should provide an actionable Android recovery path');
assert.match(storage, /CURRENT_SCHEMA_VERSION = 5/, 'storage schema should be versioned');
assert.match(storage, /getRecoveryState/, 'storage should expose read-only recovery state');
assert.match(storage, /aiMode: 'custom'/, 'self-managed key should remain the safe default mode');
assert.match(storage, /saveTransactions/, 'storage should support atomic batch writes');
assert.match(storage, /cloudSyncEnabled: false/, 'cloud sync should remain opt-in');
assert.match(aiParser, /绝不能把跨日期金额相加成一笔/, 'batch prompt should forbid cross-date aggregation');
assert.match(aiParser, /父账单只是结算容器/, 'batch prompt should treat folded parents as settlement containers');
assert.match(foldedCategories, /kind: 'mixed'/, 'folded category summary should represent mixed-category parents');
assert.match(foldedCategories, /\? '其他'/, 'mixed folded parents should use a neutral compatibility category');
assert.match(aiInput, /综合采购/, 'mixed folded bills should show a neutral summary instead of a parent category picker');
assert.match(aiInput, /grid-cols-\[5\.5rem_minmax\(0,1fr\)\]/, 'split-item fields should constrain the description column on mobile');
assert.match(aiInput, /<select aria-label=\{`第\$\{splitIndex \+ 1\}项商品分类`\}/, 'split-item category editing should use a compact select');
assert.doesNotMatch(app, /key=\{`input-\$\{refreshKey\}`\}/, 'saving should not remount the active input flow');
assert.match(aiInput, /查看刚入账明细/, 'successful saves should offer explicit navigation to transaction details');
assert.match(aiInput, /textareaRef\.current\?\.focus\(\)/, 'successful saves should return focus for continuous entry');
assert.doesNotMatch(aiInput, /setTimeout\(\(\) => \{\s*setSuccess\(false\);\s*onNavigateToTransactions\(\)/s, 'successful saves should not schedule forced navigation');
assert.match(aiInput, /savingRef\.current/, 'saving should guard against duplicate submissions');
assert.match(aiInput, /saveTransitionRef\.current = window\.setTimeout/, 'save confirmation should remain stable through the double-click window');
assert.doesNotMatch(aiInput, /支付方式|paymentMethod|CreditCard/, 'new entry UI should not retain payment methods');
assert.doesNotMatch(transactionList, /支付方式|paymentMethod|CreditCard/, 'transaction details should not retain payment methods');
assert.match(transactionList, /商户筛选/, 'details should support merchant filtering');
assert.match(transactionList, /subItem\.description/, 'details search should include folded product names');
assert.match(transactionList, /item\.subItems\?\.length \? item\.subItems\.some/, 'folded category filters should use child categories instead of the neutral parent field');
assert.match(transactionList, /categoryForFoldedParent\(subItems/, 'editing a child category should keep the parent compatibility field derived');
assert.match(aiParser, /只能返回 0 或 1 个短词/, 'model prompt should constrain tags to one scenario');
assert.match(aiParser, /不要返回 paymentMethod/, 'model prompt should omit payment methods');
assert.match(analytics, /paid - allocated\.reduce/, 'folded category allocation should conserve actual paid totals');
assert.match(financialInsights, /低于 40 时不得引用/, 'LLM insights should gate sparse tags');
assert.match(financialInsights, /禁止把当前不完整月份与完整月份直接比较/, 'LLM insights should not compare partial and full months');
assert.match(serverRoutes, /\/api\/model\/analyze-ledger/, 'cloud mode should expose model-backed ledger analysis');
assert.match(settings, /合并云端与本机（推荐）/, 'cloud conflicts should offer a preservation-first merge action');
assert.match(cloudSync, /mergeFromCloud/, 'cloud sync should merge before replacing either ledger');

console.log('Feature contracts verified.');
