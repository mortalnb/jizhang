import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      JWT_SECRET: 'vitest-only-secret',
      MIMO_API_KEY: 'vitest-only-key',
    },
    exclude: ['dist/**', 'node_modules/**'],
  },
});
