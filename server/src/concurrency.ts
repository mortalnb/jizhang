import { AppError } from './errors.js';

const limits = { audio: 1, image: 1, text: 2 } as const;
const active = { audio: 0, image: 0, text: 0 };

export const withModelSlot = async <T>(kind: keyof typeof limits, work: () => Promise<T>) => {
  if (active[kind] >= limits[kind]) throw new AppError(429, 'model_busy', 'Too many concurrent model requests');
  active[kind] += 1;
  try { return await work(); } finally { active[kind] -= 1; }
};
