import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      APP_SECRET: 'test-secret-test-secret-test-secret',
      LOCAL_STORAGE_DIR: '.data/test-files',
      LOG_LEVEL: 'silent',
      SCRYPT_LOG2_N: '14', // keep the suite fast; production uses 17 (review D20)
    },
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
