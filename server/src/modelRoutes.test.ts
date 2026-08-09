import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTransactionPrompt, normalizeModelBatch, normalizeVisionBatch } from './modelContracts.js';
import { checksumLedgerPayload, ledgerUpdateSchema } from './ledgerContracts.js';

const categories = ['餐费', '饮料', '交通', '日用', '其他'];

describe('batch transaction contract', () => {
  it('preserves different dates as independent transactions', () => {
    const result = normalizeModelBatch({
      transactions: [
        { amount: 18, category: '饮料', paymentMethod: '支付宝', description: '咖啡', date: '2026-08-01' },
        { amount: 3, category: '交通', paymentMethod: '微信支付', description: '地铁', date: '2026-08-02' },
      ],
    }, categories);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.map(item => item.date)).toEqual(['2026-08-01', '2026-08-02']);
  });

  it('keeps one supermarket checkout folded with paid total', () => {
    const result = normalizeVisionBatch({
      source: 'walmart',
      amount: 36,
      transactions: [{
        amount: 36,
        category: '日用',
        paymentMethod: '支付宝',
        description: '沃尔玛采购',
        date: '2026-08-09',
        splitItems: [
          { amount: 20, category: '日用', description: '纸巾', quantity: '1提' },
          { amount: 18, category: '饮料', description: '牛奶', quantity: '1箱' },
        ],
      }],
    }, categories);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount).toBe(36);
    expect(result.transactions[0].splitItems).toHaveLength(2);
  });

  it('states the non-negotiable split rules in the prompt', () => {
    const prompt = buildTransactionPrompt(categories, '2026-08-09');
    expect(prompt).toContain('绝不能把跨日期金额相加成一笔');
    expect(prompt).toContain('沃尔玛');
    expect(prompt).toContain('多个订单');
  });
});
describe('ledger snapshot contract', () => {
  const payload = {
    schemaVersion: 4,
    settings: { categories, monthlyBudget: 3000 },
    transactions: [{
      id: 'tx-1', amount: 18, category: '饮料', date: '2026-08-01', paymentMethod: '', description: '咖啡',
    }],
  };

  it('uses a JSON-roundtrip-stable checksum', () => {
    expect(checksumLedgerPayload(payload)).toBe(checksumLedgerPayload(JSON.parse(JSON.stringify(payload))));
    expect(ledgerUpdateSchema.parse({ checksum: checksumLedgerPayload(payload), expectedRevision: 0, payload }).payload.transactions).toHaveLength(1);
  });

  it('ships ASR and cloud ledger endpoints', () => {
    const modelRoutes = readFileSync(new URL('./modelRoutes.ts', import.meta.url), 'utf8');
    const ledgerRoutes = readFileSync(new URL('./ledgerRoutes.ts', import.meta.url), 'utf8');
    expect(modelRoutes).toContain('/api/model/transcribe-audio');
    expect(modelRoutes).toContain("z.literal('mimo-v2.5-asr')");
    expect(ledgerRoutes).toContain('/api/ledger-snapshot');
  });
});
