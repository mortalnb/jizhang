import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } });
try {
  const { ledgerItemsForStats, tagCoverage } = await vite.ssrLoadModule('/src/services/ledgerAnalytics.ts');
  const transactions = [{
    id: 'discounted-order',
    amount: 36,
    category: '日用',
    date: '2026-08-09',
    description: '沃尔玛采购',
    tag: '超市采购',
    subItems: [
      { amount: 20, category: '日用', description: '纸巾' },
      { amount: 18, category: '饮料', description: '牛奶' },
    ],
  }];
  const items = ledgerItemsForStats(transactions);
  assert.equal(items.length, 2);
  assert.equal(Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2)), 36, 'allocated category items must equal actual paid total');
  assert.deepEqual(items.map(item => item.amount), [18.95, 17.05], 'discount allocation should be deterministic to the cent');
  assert.equal(tagCoverage(transactions), 1);
  assert.equal(tagCoverage([...transactions, { ...transactions[0], id: 'untagged', tag: undefined }]), 0.5);
  console.log('Ledger analytics preserve actual paid totals across folded line items.');
} finally {
  await vite.close();
}
