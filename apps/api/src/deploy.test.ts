import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Deployment config checks that do not need AWS (review C15). */
describe('serverless.yml', () => {
  it('C15: the files bucket CORS is restricted to the app origin, not "*"', () => {
    const yml = readFileSync(fileURLToPath(new URL('../../../serverless.yml', import.meta.url)), 'utf8');
    const cors = yml.slice(yml.indexOf('CorsConfiguration'), yml.indexOf('CorsConfiguration') + 400);
    expect(cors).not.toMatch(/AllowedOrigins:\s*\[\s*'\*'\s*\]/);
    expect(cors).toMatch(/app-url/);
  });
});
