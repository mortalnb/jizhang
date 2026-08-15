import assert from 'node:assert/strict';
import { categoryForFoldedParent, summarizeFoldedCategories } from '../src/services/foldedCategories.ts';

const mixedItems = [
  { category: '日用' },
  { category: '饮料' },
  { category: '饮料' },
  { category: '水果' },
];

assert.deepEqual(summarizeFoldedCategories(), { categories: [], kind: 'none' });
assert.deepEqual(summarizeFoldedCategories([{ category: '饮料' }, { category: '饮料' }]), {
  categories: ['饮料'],
  category: '饮料',
  kind: 'single',
});
assert.deepEqual(summarizeFoldedCategories(mixedItems), {
  categories: ['日用', '饮料', '水果'],
  kind: 'mixed',
});
assert.equal(categoryForFoldedParent([{ category: '饮料' }], '餐费'), '饮料');
assert.equal(categoryForFoldedParent(mixedItems, '饮料'), '其他');
assert.equal(categoryForFoldedParent(undefined, '餐费'), '餐费');

console.log('Folded category semantics verified.');
