import { z } from 'zod';

const splitItemSchema = z.object({
  amount: z.number().finite().nonnegative(),
  category: z.string().min(1).max(20),
  description: z.string().min(1).max(200),
  detail: z.string().max(2000).optional(),
  quantity: z.string().max(100).optional(),
  tag: z.string().max(60).optional(),
});

const transactionSchema = z.object({
  id: z.string().min(1).max(128),
  amount: z.number().finite().nonnegative(),
  category: z.string().min(1).max(20),
  date: z.string().regex(/^20\d{2}-\d{2}-\d{2}$/),
  // Kept optional for schema <=4 snapshots; schema 5 clients no longer emit it.
  paymentMethod: z.string().max(60).optional(),
  description: z.string().min(1).max(200),
  detail: z.string().max(3000).optional(),
  recognition: z.object({
    itemCount: z.number().int().nonnegative().optional(),
    source: z.string().max(80).optional(),
    warnings: z.array(z.string().max(500)).max(50).optional(),
  }).optional(),
  subItems: z.array(splitItemSchema).max(500).optional(),
  tag: z.string().max(60).optional(),
  batchId: z.string().max(128).optional(),
  merchant: z.string().max(160).optional(),
  orderId: z.string().max(160).optional(),
});

export const ledgerPayloadSchema = z.object({
  schemaVersion: z.number().int().min(1).max(5),
  settings: z.object({
    categories: z.array(z.string().min(1).max(20)).min(1).max(100),
    monthlyBudget: z.number().finite().nonnegative().max(100_000_000),
  }),
  transactions: z.array(transactionSchema).max(50_000),
});

export const ledgerUpdateSchema = z.object({
  checksum: z.string().regex(/^fnv1a-[0-9a-f]{8}$/),
  expectedRevision: z.number().int().nonnegative(),
  payload: ledgerPayloadSchema,
});

const stableNormalized = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableNormalized).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableNormalized(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

export const checksumLedgerPayload = (value: unknown) => {
  const canonical = JSON.parse(JSON.stringify(value)) as unknown;
  let hash = 0x811c9dc5;
  for (const char of stableNormalized(canonical)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};
