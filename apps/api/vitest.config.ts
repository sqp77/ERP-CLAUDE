import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    globalSetup: ['./src/test/globalSetup.ts'],
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    include: ['src/**/*.test.ts'],
  },
});
