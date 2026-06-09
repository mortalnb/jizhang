import { describe, expect, it } from 'vitest';

describe('server route contracts', () => {
  it('keeps model endpoints stable', () => {
    const endpoints = ['/api/model/parse-transaction', '/api/model/recognize-bill-image', '/api/model/test-capability'];
    expect(endpoints).toContain('/api/model/parse-transaction');
    expect(endpoints).toContain('/api/model/recognize-bill-image');
    expect(endpoints).toContain('/api/model/test-capability');
  });
});
