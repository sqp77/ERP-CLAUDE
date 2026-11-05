import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Logic-level tests only (no DOM): date helpers, API client rules, form mappers and source hygiene. */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/*.test.ts'], globals: false },
});
