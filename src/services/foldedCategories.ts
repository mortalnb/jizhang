type CategorizedItem = {
  category: string;
};

export interface FoldedCategorySummary {
  categories: string[];
  category?: string;
  kind: 'none' | 'single' | 'mixed';
}

export const summarizeFoldedCategories = (items?: CategorizedItem[]): FoldedCategorySummary => {
  const categories = Array.from(new Set((items ?? []).map(item => item.category.trim()).filter(Boolean)));
  if (categories.length === 0) return { categories, kind: 'none' };
  if (categories.length === 1) return { categories, category: categories[0], kind: 'single' };
  return { categories, kind: 'mixed' };
};

/**
 * A folded parent is a settlement container, not another category allocation.
 * Keep the required legacy field derived from its children: a shared category
 * when every item agrees, otherwise a neutral compatibility value.
 */
export const categoryForFoldedParent = (
  items: CategorizedItem[] | undefined,
  fallback = '其他',
) => {
  const summary = summarizeFoldedCategories(items);
  return summary.kind === 'single' ? summary.category ?? fallback : summary.kind === 'mixed' ? '其他' : fallback;
};
