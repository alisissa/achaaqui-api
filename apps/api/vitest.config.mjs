import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    exclude: ['test/**/*.integration.spec.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
  },
});
