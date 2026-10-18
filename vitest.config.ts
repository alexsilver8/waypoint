import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'extensions/**/*.test.js', 'packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
