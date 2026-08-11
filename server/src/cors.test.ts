import { describe, expect, it } from 'vitest';
import { corsMethods } from './cors.js';

describe('CORS methods', () => {
  it('allows the ledger snapshot write method', () => {
    expect(corsMethods).toContain('PUT');
  });
});
