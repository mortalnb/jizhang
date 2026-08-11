import type { Transaction } from '../types';

export interface LedgerAnalyticsItem {
  amount: number;
  category: string;
  date: string;
  description: string;
  parentId: string;
  tag?: string;
}

const cents = (amount: number) => Math.max(0, Math.round(Number(amount) * 100));

/**
 * Allocate the parent's actual paid amount across line items. This keeps every
 * dashboard total conserved even when coupons make listed item prices differ
 * from the checkout total.
 */
const allocatedSubItemCents = (transaction: Transaction) => {
  const items = transaction.subItems ?? [];
  const paid = cents(transaction.amount);
  const weights = items.map(item => Math.max(0, Number(item.amount) || 0));
  const weightTotal = weights.reduce((sum, amount) => sum + amount, 0);
  if (!items.length || weightTotal <= 0) return [];
  const exact = weights.map(weight => (weight / weightTotal) * paid);
  const allocated = exact.map(value => Math.floor(value));
  let remaining = paid - allocated.reduce((sum, amount) => sum + amount, 0);
  const order = exact
    .map((value, index) => ({ fraction: value - Math.floor(value), index }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; remaining > 0; index = (index + 1) % order.length) {
    allocated[order[index].index] += 1;
    remaining -= 1;
  }
  return allocated;
};

export const ledgerItemsForStats = (transactions: Transaction[]): LedgerAnalyticsItem[] =>
  transactions.flatMap(transaction => {
    const allocated = allocatedSubItemCents(transaction);
    if (!transaction.subItems?.length || !allocated.length) {
      return [{
        amount: cents(transaction.amount) / 100,
        category: transaction.category,
        date: transaction.date,
        description: transaction.description,
        parentId: transaction.id,
        tag: transaction.tag,
      }];
    }
    return transaction.subItems.map((item, index) => ({
      amount: allocated[index] / 100,
      category: item.category,
      date: transaction.date,
      description: item.description,
      parentId: transaction.id,
      tag: transaction.tag,
    }));
  });

export const tagCoverage = (transactions: Transaction[]) => {
  if (!transactions.length) return 0;
  return transactions.filter(transaction => Boolean(transaction.tag)).length / transactions.length;
};
