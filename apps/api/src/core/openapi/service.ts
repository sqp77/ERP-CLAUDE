import type { Express } from 'express';
import type { ZodTypeAny } from 'zod';
import { SESSION_COOKIE } from '../auth/session';

/**
 * The API document [SAL §18 (20) «توثيق واجهات الربط البرمجية»], generated from the running Express app so it can never
 * drift from the code: every mounted route with its method and path, the zod schema its `validate()` enforces (body,
 * query, params), whether it needs a session (`requireAuth`) and the permission its `authorize()` checks. OpenAPI 3.0.
 */

type JsonSchema = Record<string, unknown>;
interface Layer {
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: { handle: Tagged }[] };
  name?: string;
  regexp?: RegExp & { fast_slash?: boolean };
  keys?: { name: string }[];
  handle?: { stack?: Layer[] } & Tagged;
}
type Tagged = ((...args: never[]) => unknown) & {
  openapi?: { schema: ZodTypeAny; part: 'body' | 'query' | 'params' };
  permission?: { resource: string; action: string };
  authRequired?: boolean;
};

export interface RouteInfo {
  method: string;
  path: string;
  authRequired: boolean;
  permission?: { resource: string; action: string };
  schemas: { part: 'body' | 'query' | 'params'; schema: ZodTypeAny }[];
}

/** Mount path of a router layer from its Express 4 regexp (`/^\/sales\/management\/?(?=\/|$)/i`). */
function mountPath(layer: Layer): string {
  if (!layer.regexp || layer.regexp.fast_slash) return '';
  let src = layer.regexp.source
    .replace('\\/?(?=\\/|$)', '')
    .replace(/^\^/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/');
  let i = 0;
  src = src.replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => `:${layer.keys?.[i++]?.name ?? 'param'}`);
  return src;
}

export function collectRoutes(app: Express): RouteInfo[] {
  const out: RouteInfo[] = [];
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        const handles = layer.route.stack.map((s) => s.handle);
        for (const p of paths)
          for (const method of Object.keys(layer.route.methods).filter((m) => layer.route!.methods[m]))
            out.push({
              method,
              path: (prefix + p).replace(/\/+$/, '') || '/',
              authRequired: handles.some((h) => h.authRequired),
              permission: handles.find((h) => h.permission)?.permission,
              schemas: handles.filter((h) => h.openapi).map((h) => h.openapi!),
            });
      } else if (layer.name === 'router' && layer.handle?.stack)
        walk(layer.handle.stack, prefix + mountPath(layer));
    }
  };
  const root = (app as unknown as { _router?: { stack: Layer[] } })._router;
  if (root) walk(root.stack, '');
  return out;
}

/** zod → JSON Schema for the shapes this code base uses (objects, strings, numbers, enums, arrays, unions…). */
export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  const def = schema._def as { typeName: string } & Record<string, unknown>;
  const desc = schema.description ? { description: schema.description } : {};
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (schema as unknown as { shape: Record<string, ZodTypeAny> }).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = zodToJsonSchema(v);
        if (!v.isOptional()) required.push(k);
      }
      return { type: 'object', properties, ...(required.length ? { required } : {}), ...desc };
    }
    case 'ZodString': {
      const checks = (def.checks as { kind: string; value?: number; regex?: RegExp }[]) ?? [];
      const out: JsonSchema = { type: 'string', ...desc };
      for (const c of checks) {
        if (c.kind === 'min') out.minLength = c.value;
        if (c.kind === 'max') out.maxLength = c.value;
        if (c.kind === 'email') out.format = 'email';
        if (c.kind === 'url') out.format = 'uri';
        if (c.kind === 'regex' && c.regex) out.pattern = c.regex.source;
      }
      return out;
    }
    case 'ZodNumber': {
      const checks = (def.checks as { kind: string; value?: number }[]) ?? [];
      const out: JsonSchema = { type: checks.some((c) => c.kind === 'int') ? 'integer' : 'number', ...desc };
      for (const c of checks) {
        if (c.kind === 'min') out.minimum = c.value;
        if (c.kind === 'max') out.maximum = c.value;
      }
      return out;
    }
    case 'ZodBoolean':
      return { type: 'boolean', ...desc };
    case 'ZodDate':
      return { type: 'string', format: 'date-time', ...desc };
    case 'ZodEnum':
      return { type: 'string', enum: def.values as string[], ...desc };
    case 'ZodNativeEnum':
      return { enum: Object.values(def.values as object), ...desc };
    case 'ZodLiteral':
      return { enum: [def.value], ...desc };
    case 'ZodArray':
      return { type: 'array', items: zodToJsonSchema(def.type as ZodTypeAny), ...desc };
    case 'ZodRecord':
      return { type: 'object', additionalProperties: zodToJsonSchema(def.valueType as ZodTypeAny), ...desc };
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = (def.options as ZodTypeAny[] | Map<unknown, ZodTypeAny>) ?? [];
      const list = options instanceof Map ? [...options.values()] : options;
      return { oneOf: list.map(zodToJsonSchema), ...desc };
    }
    case 'ZodIntersection':
      return { allOf: [zodToJsonSchema(def.left as ZodTypeAny), zodToJsonSchema(def.right as ZodTypeAny)] };
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodReadonly':
    case 'ZodBranded':
    case 'ZodCatch': {
      const inner = zodToJsonSchema((def.innerType ?? def.type) as ZodTypeAny);
      return def.typeName === 'ZodNullable' ? { ...inner, nullable: true } : inner;
    }
    case 'ZodDefault': {
      const inner = zodToJsonSchema(def.innerType as ZodTypeAny);
      let value: unknown;
      try {
        value = (def.defaultValue as () => unknown)();
      } catch {
        value = undefined;
      }
      return value === undefined ? inner : { ...inner, default: value };
    }
    case 'ZodEffects':
      return zodToJsonSchema(def.schema as ZodTypeAny);
    case 'ZodPipeline':
      return zodToJsonSchema(def.in as ZodTypeAny);
    case 'ZodLazy':
      return zodToJsonSchema((def.getter as () => ZodTypeAny)());
    default:
      return { ...desc };
  }
}

const TAG_AR: Record<string, string> = {
  crm: 'إدارة العملاء (CRM)',
  sales: 'المبيعات',
  finance: 'المالية',
  calendar: 'التقويم',
  discussions: 'النقاشات بين الأقسام',
  tasks: 'المهام',
  files: 'الملفات',
  export: 'التصدير والتقارير',
  parties: 'الجهات الخارجية',
  tags: 'الوسوم',
  comments: 'التعليقات',
  notifications: 'الإشعارات',
};

/** The tag of a path: `/api/v1/sales/quotes/:id` → `sales/quotes`, so Sales and CRM endpoints group by screen. */
function tagOf(path: string): string {
  const parts = path
    .replace(/^\/api\/v1\//, '')
    .split('/')
    .filter(Boolean);
  if (!parts.length) return 'root';
  if (
    (parts[0] === 'sales' || parts[0] === 'crm' || parts[0] === 'finance') &&
    parts[1] &&
    !parts[1].startsWith(':')
  )
    return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

export function buildOpenApi(app: Express, opts: { prefix?: string } = {}) {
  const routes = collectRoutes(app).filter(
    (r) => r.path.startsWith('/api/') && (!opts.prefix || r.path.startsWith(opts.prefix)),
  );
  const paths: Record<string, Record<string, unknown>> = {};
  const tags = new Set<string>();
  for (const r of routes) {
    const path = r.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const tag = tagOf(r.path);
    tags.add(tag);
    const params: JsonSchema[] = [...r.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    let requestBody: JsonSchema | undefined;
    for (const s of r.schemas) {
      const json = zodToJsonSchema(s.schema);
      if (s.part === 'body')
        requestBody = { required: true, content: { 'application/json': { schema: json } } };
      else if (s.part === 'query') {
        const props = (json.properties ?? {}) as Record<string, JsonSchema>;
        const required = new Set((json.required as string[]) ?? []);
        for (const [name, schema] of Object.entries(props))
          params.push({ name, in: 'query', required: required.has(name) && !('default' in schema), schema });
      }
    }
    const method = r.method.toLowerCase();
    paths[path] ??= {};
    paths[path][method] = {
      tags: [tag],
      operationId: `${method}_${r.path.replace(/^\/api\/v1\//, '').replace(/[^A-Za-z0-9]+/g, '_')}`,
      ...(params.length ? { parameters: params } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses: {
        [method === 'post' ? '201' : method === 'delete' ? '204' : '200']: { description: 'OK' },
        ...(requestBody || params.some((p) => p.in === 'query')
          ? { '400': { description: 'بيانات غير صحيحة' } }
          : {}),
        ...(r.authRequired ? { '401': { description: 'يلزم تسجيل الدخول' } } : {}),
        ...(r.permission ? { '403': { description: 'لا توجد صلاحية' } } : {}),
      },
      ...(r.authRequired ? { security: [{ session: [] }, { bearer: [] }] } : { security: [] }),
      ...(r.permission ? { 'x-permission': `${r.permission.resource}:${r.permission.action}` } : {}),
      ...(r.authRequired && !r.permission
        ? { description: 'الصلاحية تُتحقق داخل الخدمة حسب السجل وقسم المستخدم.' }
        : {}),
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Eayni ERP API',
      version: '1.0.0',
      description:
        'واجهات الربط البرمجية لنظام جمعية عيني. الصلاحيات تُفرض في الخادم (x-permission = المورد:الإجراء)، والجلسة عبر ملف تعريف الارتباط.',
    },
    servers: [{ url: '/' }],
    tags: [...tags].sort().map((name) => ({ name, description: TAG_AR[name.split('/')[0]] ?? undefined })),
    components: {
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
        bearer: { type: 'http', scheme: 'bearer' },
      },
    },
    paths,
  };
}
