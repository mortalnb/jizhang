import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTransactionPrompt, buildVisionPrompt, normalizeModelBatch, normalizeVisionBatch } from './modelContracts.js';
import { checksumLedgerPayload, ledgerUpdateSchema } from './ledgerContracts.js';
import { extractModelContent } from './mimo.js';

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
    expect(result.transactions.every(item => !Object.hasOwn(item, 'paymentMethod'))).toBe(true);
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
    expect(result.transactions[0]).not.toHaveProperty('paymentMethod');
  });

  it.each([undefined, null, '', '   '])('keeps a screenshot with unknown date editable without inventing a date (%s)', date => {
    const result = normalizeVisionBatch({
      source: 'hema',
      transactions: [{
        amount: 36,
        category: '其他',
        description: '盒马采购',
        date,
        splitItems: [
          { amount: 20, category: '日用', description: '纸巾', quantity: '1提' },
          { amount: 18, category: '饮料', description: '牛奶', quantity: '1箱' },
        ],
      }],
      warnings: ['商品金额与实付不同，请核对优惠。'],
    }, categories);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({ amount: 36, grouping: 'folded' });
    expect(result.transactions[0].splitItems?.map(item => item.amount)).toEqual([20, 18]);
    expect(JSON.parse(JSON.stringify(result)).transactions[0]).not.toHaveProperty('date');
    expect(result.warnings).toEqual([
      '日期待确认：1 笔账单未识别到日期，请在确认页核对日期。',
      '商品金额与实付不同，请核对优惠。',
    ]);
  });

  it('preserves separate order boundaries and a known date when another date is missing', () => {
    const result = normalizeVisionBatch({
      source: 'taobao',
      transactions: [
        { amount: 18, category: '饮料', description: '牛奶', orderId: 'order-1', date: '2026-08-01' },
        { amount: 25, category: '日用', description: '纸巾', orderId: 'order-2' },
      ],
    }, categories);
    expect(result.transactions.map(item => item.amount)).toEqual([18, 25]);
    expect(result.transactions.map(item => item.orderId)).toEqual(['order-1', 'order-2']);
    expect(result.transactions[0].date).toBe('2026-08-01');
    expect(result.transactions[1].date).toBeUndefined();
    expect(result.warnings).toEqual(['日期待确认：1 笔账单未识别到日期，请在确认页核对日期。']);
  });

  it.each(['10-09', '2026/10/09', 'not-a-date', 123, false])('rejects a supplied invalid vision date (%s)', date => {
    expect(() => normalizeVisionBatch({
      transactions: [{ amount: 18, category: '饮料', description: '咖啡', date }],
    }, categories)).toThrow();
  });

  it.each([undefined, null, '', '   '])('keeps text parsing strict about missing dates (%s)', date => {
    expect(() => normalizeModelBatch({
      transactions: [{ amount: 18, category: '饮料', description: '咖啡', date }],
    }, categories)).toThrow();
  });

  it('keeps vision amount and title validation when the date is unknown', () => {
    for (const amount of [undefined, null, -1, 'unknown']) {
      expect(() => normalizeVisionBatch({
        transactions: [{ amount, category: '饮料', description: '咖啡' }],
      }, categories)).toThrow();
    }
    expect(() => normalizeVisionBatch({
      transactions: [{ amount: 18, category: '饮料', description: '合成商品名'.repeat(26) }],
    }, categories)).toThrow();
  });

  it('keeps a bounded date warning even when the model already returned 30 warnings', () => {
    const result = normalizeVisionBatch({
      transactions: [{ amount: 18, category: '饮料', description: '咖啡' }],
      warnings: Array.from({ length: 30 }, (_, index) => `需核对项目 ${index + 1}`),
    }, categories);
    expect(result.warnings).toHaveLength(30);
    expect(result.warnings?.[0]).toContain('日期待确认');
  });

  it('does not add a date warning when every screenshot date is known', () => {
    const result = normalizeVisionBatch({
      transactions: [{ amount: 18, category: '饮料', description: '咖啡', date: '2026-08-01' }],
      warnings: ['请核对金额。'],
    }, categories);
    expect(result.transactions[0].date).toBe('2026-08-01');
    expect(result.warnings).toEqual(['请核对金额。']);
  });

  it('tells vision to preserve unknown dates and stay inside the schema bounds', () => {
    const prompt = buildVisionPrompt(categories, '2026-08-09');
    expect(prompt).toContain('看不到完整日期时省略 date 或返回 null');
    expect(prompt).toContain('不能用今天代替或猜测年份');
    expect(prompt).toContain('1 至 120 字');
    expect(prompt).toContain('父级 detail 最多 1500 字');
    expect(prompt).toContain('商品 detail 最多 1000 字');
    expect(prompt).toContain('quantity 是最多 80 字');
    expect(prompt).toContain('transactions 必须有 1 至 80 笔');
    expect(prompt).toContain('splitItems 最多 250 项');
    expect(prompt).toContain('warnings 最多 30 条，每条最多 300 字');
    expect(prompt).toContain('父级 amount 是优惠后的实际支付总额');
    expect(prompt).toContain('多个订单、不同日期或多次实付款必须返回多笔');
  });

  it('states the non-negotiable split rules in the prompt', () => {
    const prompt = buildTransactionPrompt(categories, '2026-08-09');
    expect(prompt).toContain('绝不能把跨日期金额相加成一笔');
    expect(prompt).toContain('沃尔玛');
    expect(prompt).toContain('多个订单');
    expect(prompt).toContain('只能返回 0 或 1 个短词');
    expect(prompt).toContain('不要返回 paymentMethod');
  });
});
describe('ledger snapshot contract', () => {
  const payload = {
    schemaVersion: 5,
    settings: { categories, monthlyBudget: 3000 },
    transactions: [{
      id: 'tx-1', amount: 18, category: '饮料', date: '2026-08-01', description: '咖啡',
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
    expect(modelRoutes).toContain('/api/model/analyze-ledger');
    expect(modelRoutes).toContain("z.literal('mimo-v2.5-asr')");
    expect(ledgerRoutes).toContain('/api/ledger-snapshot');
  });

  it('accepts MiMo transcript and structured text response variants', () => {
    expect(extractModelContent({ choices: [{ message: { audio: { transcript: '今天买咖啡十八元' } } }] })).toBe('今天买咖啡十八元');
    expect(extractModelContent({ choices: [{ message: { content: [{ text: '第一段' }, { text: '第二段' }] } }] })).toBe('第一段第二段');
  });
});
