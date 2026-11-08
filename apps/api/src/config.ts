import { z } from 'zod';

/**
 * Environment configuration. Secrets come from SSM in deployed stages (serverless.yml);
 * locally from a `.env`-free shell or the defaults below (development only).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Deployment stage from serverless.yml (`staging`, `prod`); unset locally. Gates the staging-only demo seed. */
  STAGE: z.string().optional(),
  PORT: z.coerce.number().int().default(4000),
  MONGODB_URI: z.string().optional(),
  /** Root secret: per-purpose keys are derived from it (HKDF). Must be set in production. */
  APP_SECRET: z.string().min(16).default('dev-only-secret-change-me-0123456789'),
  /** Previous root secret, accepted for decryption only, while rotating APP_SECRET (review D21). */
  APP_SECRET_PREVIOUS: z.string().min(16).optional(),
  /** scrypt cost as log2(N); 17 in deployed stages (review D20). Tests lower it to keep the suite fast. */
  SCRYPT_LOG2_N: z.coerce.number().int().min(12).max(20).default(17),
  APP_URL: z.string().default('http://localhost:5173'),
  /**
   * Proxy hops in front of the API whose X-Forwarded-For entries are trusted (review E11). Locally 1 (Vite proxy);
   * CloudFront → API Gateway → Lambda = 2 (the client address is the entry before the two proxies).
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /**
   * Shared secret CloudFront adds as `x-origin-secret` (go-live follow-up 2). When set, every request except the health
   * check must carry it, and the client IP is read from `CloudFront-Viewer-Address`. Required in production.
   */
  ORIGIN_SECRET: z.string().min(16).optional(),
  /** The previous origin secret, accepted during a rotation (empty string = none). */
  ORIGIN_SECRET_PREVIOUS: z
    .string()
    .optional()
    .transform((v) => (v && v.length >= 16 ? v : undefined)),
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
    if (cached.NODE_ENV === 'production' && !cached.ORIGIN_SECRET) {
      throw new Error('ORIGIN_SECRET must be set in production (CloudFront origin header)');
    }
    if (cached.NODE_ENV === 'production' && cached.APP_SECRET.startsWith('dev-only')) {
      throw new Error('APP_SECRET must be set in production');
    }
  }
  return cached;
}

/** Tests only: forget the parsed environment so changed variables are read again. */
export function resetEnvCache(): void {
  cached = undefined;
}

export const isProd = () => env().NODE_ENV === 'production';
export const isTest = () => env().NODE_ENV === 'test';
