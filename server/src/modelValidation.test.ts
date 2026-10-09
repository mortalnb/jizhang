import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from './errors.js';
import { validateModelResult } from './modelValidation.js';

describe('model contract diagnostics', () => {
  it('logs actionable paths and limits without rejected data or messages', () => {
    const logger = { warn: vi.fn() };
    const schema = z.object({ transactions: z.array(z.object({ description: z.string().max(3), date: z.string() })) });
    expect(() => validateModelResult(() => schema.parse({ transactions: [{ description: 'PRIVATE_LEDGER_TEXT', date: null }] }), logger, 'recognize-bill-image')).toThrow(AppError);
    const metadata = logger.warn.mock.calls[0][0];
    expect(metadata).toMatchObject({ event: 'mimo_contract_error', endpoint: 'recognize-bill-image', kind: 'schema', issueCount: 2 });
    expect(metadata.issues).toEqual([
      { path: ['transactions', 0, 'description'], code: 'too_big', maximum: 3 },
      { path: ['transactions', 0, 'date'], code: 'invalid_type' },
    ]);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('PRIVATE_LEDGER_TEXT');
    expect(metadata.issues.every((issue: object) => !Object.hasOwn(issue, 'message') && !Object.hasOwn(issue, 'input'))).toBe(true);
  });

  it('redacts dynamic property paths and parse error messages', () => {
    const logger = { warn: vi.fn() };
    const schema = z.record(z.string(), z.number());
    expect(() => validateModelResult(() => schema.parse({ PRIVATE_FIELD: 'PRIVATE_VALUE' }), logger, 'parse-transaction')).toThrow();
    expect(logger.warn.mock.calls[0][0].issues[0].path).toEqual(['unknown']);
    expect(() => validateModelResult(() => { throw new SyntaxError('PRIVATE_JSON_FRAGMENT'); }, logger, 'parse-transaction')).toThrow();
    expect(logger.warn.mock.calls[1][0]).toMatchObject({ kind: 'json' });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('PRIVATE_');
  });

  it('does not log successful results and caps repeated failures', () => {
    const logger = { warn: vi.fn() };
    expect(validateModelResult(() => 42, logger, 'parse-transaction')).toBe(42);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(() => validateModelResult(() => z.array(z.number()).parse(Array(30).fill(null)), logger, 'parse-transaction')).toThrow();
    expect(logger.warn.mock.calls[0][0].issues).toHaveLength(20);
    expect(logger.warn.mock.calls[0][0].issueCount).toBe(30);
  });
});
