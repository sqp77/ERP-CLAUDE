import { z } from 'zod';

/**
 * Environment configuration. Secrets come from SSM in deployed stages (serverless.yml);
 * locally from a `.env`-free shell or the defaults below (development only).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  MONGODB_URI: z.string().optional(),
  /** Used to encrypt TOTP secrets and sign local file tokens. Must be set in production. */
  APP_SECRET: z.string().min(16).default('dev-only-secret-change-me-0123456789'),
  APP_URL: z.string().default('http://localhost:5173'),
  API_URL: z.string().default('http://localhost:4000'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  FILE_STORAGE: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('.data/files'),
  S3_BUCKET: z.string().optional(),
  AWS_REGION: z.string().optional(),
  EMAIL_FROM: z.string().default('no-reply@eayni.local'),
  LOG_LEVEL: z.string().default('info'),
  /** Dev convenience: when MONGODB_URI is empty, start an in-process MongoDB that persists under .data/mongo. */
  DEV_AUTO_MONGO: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  SEED_ADMIN_EMAIL: z.string().default('admin@eayni.local'),
  SEED_ADMIN_PASSWORD: z.string().default('Admin12345!'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;
export function env(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    cached = parsed.data;
    if (cached.NODE_ENV === 'production' && cached.APP_SECRET.startsWith('dev-only')) {
      throw new Error('APP_SECRET must be set in production');
    }
  }
  return cached;
}

export const isProd = () => env().NODE_ENV === 'production';
export const isTest = () => env().NODE_ENV === 'test';
