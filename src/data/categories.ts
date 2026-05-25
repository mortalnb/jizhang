export const DEFAULT_CATEGORIES = [
  '餐费',
  '饮料',
  '交通',
  '娱乐',
  '日用',
  '服饰',
  '数码',
  '人情',
  '医疗',
  '交费',
  '维修',
  '其他',
];

export const CATEGORY_EMOJIS: Record<string, string> = {
  餐费: '🍱',
  饮料: '🥤',
  餐饮: '🍜',
  交通: '🚇',
  娱乐: '🎬',
  日用: '🧴',
  服饰: '👕',
  数码: '📱',
  人情: '🎁',
  医疗: '🏥',
  交费: '💡',
  维修: '🔧',
  其他: '🧾',
  加油: '⛽',
  补给: '🛒',
  理财: '📈',
  房租: '🏠',
};

export const CATEGORY_COLORS: Record<string, string> = {
  餐费: 'from-orange-500/70 to-amber-400/70',
  饮料: 'from-cyan-500/70 to-blue-400/70',
  餐饮: 'from-orange-500/70 to-amber-400/70',
  交通: 'from-sky-500/70 to-cyan-400/70',
  娱乐: 'from-fuchsia-500/70 to-pink-400/70',
  日用: 'from-emerald-500/70 to-teal-400/70',
  服饰: 'from-rose-500/70 to-pink-400/70',
  数码: 'from-indigo-500/70 to-violet-400/70',
  人情: 'from-red-500/70 to-orange-400/70',
  医疗: 'from-teal-500/70 to-cyan-400/70',
  交费: 'from-yellow-500/70 to-lime-400/70',
  维修: 'from-stone-500/70 to-zinc-400/70',
  其他: 'from-slate-500/70 to-gray-400/70',
  加油: 'from-yellow-500/70 to-amber-400/70',
  补给: 'from-lime-500/70 to-emerald-400/70',
  理财: 'from-green-500/70 to-emerald-400/70',
  房租: 'from-amber-500/70 to-orange-400/70',
};

export const getCategoryEmoji = (category: string) => {
  if (CATEGORY_EMOJIS[category]) return CATEGORY_EMOJIS[category];
  const matched = Object.entries(CATEGORY_EMOJIS).find(([key]) => category.includes(key) || key.includes(category));
  return matched?.[1] ?? '🧾';
};

export const getCategoryGradient = (category: string) => {
  if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category];
  const matched = Object.entries(CATEGORY_COLORS).find(([key]) => category.includes(key) || key.includes(category));
  return matched?.[1] ?? CATEGORY_COLORS.其他;
};
