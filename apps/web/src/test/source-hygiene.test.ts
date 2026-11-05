import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const webSrc = fileURLToPath(new URL('..', import.meta.url));
const apiSrc = join(webSrc, '..', '..', 'api', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}
const files = walk(webSrc).filter((p) => !p.includes('/locales/') && !p.includes('/test/'));
const read = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => relative(webSrc, p);

describe('C12 — one shared hook per lookup', () => {
  it('no page defines its own query key for departments / units / positions / branches / sites / roles', () => {
    const offenders: string[] = [];
    for (const p of files) {
      if (rel(p) === 'lib/lookups.ts') continue;
      const src = read(p);
      const m = src.match(/queryKey:\s*\[\s*'(departments|units|positions|branches|sites|roles)'/g);
      if (m) offenders.push(`${rel(p)}: ${m.join(' | ')}`);
    }
    expect(offenders).toEqual([]);
  });
  it('the router has an Arabic error element', () => {
    expect(read(join(webSrc, 'router.tsx'))).toMatch(/errorElement/);
  });
});

describe('C13 — no browser-zone date arithmetic in pages', () => {
  it('pages use the Riyadh helpers instead of local getters / toISOString().slice', () => {
    const banned = [
      /\.getMonth\(\)/,
      /\.getDate\(\)/,
      /\.getDay\(\)/,
      /\.setHours\(/,
      /toISOString\(\)\.slice\(0,\s*10\)/,
      /toDateString\(\)/,
    ];
    const offenders: string[] = [];
    for (const p of files) {
      if (!rel(p).startsWith('pages/')) continue;
      const src = read(p);
      for (const re of banned) if (re.test(src)) offenders.push(`${rel(p)}: ${re.source}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('C18 — every notification link the API emits is a route the web app serves', () => {
  it('links resolve to router paths', () => {
    const routerSrc = read(join(webSrc, 'router.tsx'));
    const routes = [...routerSrc.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
    const toRegex = (route: string) => new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}$`);
    const links = new Set<string>();
    for (const p of walk(apiSrc)) {
      const src = read(p);
      for (const m of src.matchAll(/link:\s*(?:`([^`]+)`|'([^']+)')/g)) {
        const raw = (m[1] ?? m[2]).replace(/\$\{[^}]+\}/g, ':id');
        if (raw.startsWith('/')) links.add(raw.split('?')[0]);
      }
    }
    const unresolved = [...links].filter((l) => !routes.some((r) => toRegex(r).test(l)));
    expect(unresolved).toEqual([]);
  });
});

describe('C19 — all copy lives in the translation files', () => {
  it('no Arabic string literals outside locales', () => {
    const arabic = /[؀-ۿ]/;
    const offenders: string[] = [];
    for (const p of files) {
      read(p)
        .split('\n')
        .forEach((line, i) => {
          const s = line.trim();
          if (s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) return;
          if (arabic.test(line)) offenders.push(`${rel(p)}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
  it('no English UI labels or placeholders', () => {
    const banned = [/label="IBAN"/, /placeholder="user id"/, /'IP'/, /head=\{\['#'/, /📎/];
    const offenders: string[] = [];
    for (const p of files) {
      const src = read(p);
      for (const re of banned) if (re.test(src)) offenders.push(`${rel(p)}: ${re.source}`);
    }
    expect(offenders).toEqual([]);
  });
});
