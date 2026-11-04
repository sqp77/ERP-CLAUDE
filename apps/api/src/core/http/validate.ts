import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';

type Part = 'body' | 'query' | 'params';

/** Parse one request part with zod; the parsed value replaces the raw one. */
export function validate<S extends ZodTypeAny>(schema: S, part: Part = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) return next(result.error);
    (req as unknown as Record<Part, unknown>)[part] = result.data as z.infer<S>;
    next();
  };
}
