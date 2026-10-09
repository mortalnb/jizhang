import type { FastifyBaseLogger } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './errors.js';

const fields = new Set([
  'transactions', 'warnings', 'amount', 'category', 'description', 'detail', 'date',
  'tag', 'merchant', 'orderId', 'grouping', 'splitItems', 'quantity', 'source',
  'sourceLabel', 'insights', 'title', 'body', 'tone',
]);

export const validateModelResult = <T>(work: () => T, logger: Pick<FastifyBaseLogger, 'warn'>, endpoint: string, provider: 'mimo' | 'deepseek' = 'mimo') => {
  try {
    return work();
  } catch (error) {
    // Zod messages, JSON parse messages and model values can contain ledger data.
    // Log only fixed contract field names, issue codes and numeric limits.
    const issues = error instanceof ZodError ? error.issues.slice(0, 20).map(issue => ({
      path: issue.path.map(part => typeof part === 'number' ? part : typeof part === 'string' && fields.has(part) ? part : 'unknown'),
      code: issue.code,
      ...('maximum' in issue && typeof issue.maximum === 'number' ? { maximum: issue.maximum } : {}),
      ...('minimum' in issue && typeof issue.minimum === 'number' ? { minimum: issue.minimum } : {}),
    })) : undefined;
    const kind = error instanceof ZodError ? 'schema' : error instanceof SyntaxError ? 'json' : 'content';
    const label = provider === 'deepseek' ? 'DeepSeek' : 'MiMo';
    logger.warn({ event: `${provider}_contract_error`, endpoint, kind, issues, issueCount: error instanceof ZodError ? error.issues.length : undefined }, `${label} result validation failed`);
    throw new AppError(502, `${provider}_invalid_result`, `${label} returned a result that does not match the ledger contract`);
  }
};
