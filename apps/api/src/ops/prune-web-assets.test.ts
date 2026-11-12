import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

/** A fake `aws` on PATH backed by a directory: `s3 cp` copies, `list-objects-v2` prints `old-keys`, `s3 rm` logs. */
function fakeAws(bucketDir: string) {
  const bin = mkdtempSync(join(tmpdir(), 'fake-aws-'));
  writeFileSync(
    join(bin, 'aws'),
    `#!/usr/bin/env bash
B="${bucketDir}"
case "$1 $2" in
  "s3 cp") src="$3"; dst="$4"
    if [[ "$src" == s3://* ]]; then key="\${src#s3://*/}"; [ -f "$B/$key" ] || exit 1; cp "$B/$key" "$dst"; else echo "put \${dst#s3://*/}" >> "$B/log"; fi ;;
  "s3api list-objects-v2") cat "$B/old-keys" | tr '\\n' '\\t' ;;
  "s3 rm") echo "rm \${3#s3://*/}" >> "$B/log" ;;
  *) echo "unexpected aws $*" >&2; exit 2 ;;
esac
`,
  );
  chmodSync(join(bin, 'aws'), 0o755);
  return bin;
}

function run(script: string, args: string[], bin: string) {
  return execFileSync(join(root, script), args, {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('web assets: deploy uploads the full file list and prune keeps everything in it [DECISIONS §19, Sales prompt §0]', () => {
  it('web-file-list.sh lists every file of a build, including assets index.html never names', () => {
    const dist = mkdtempSync(join(tmpdir(), 'dist-'));
    mkdirSync(join(dist, 'assets/fonts'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<script src="/assets/index-abc.js"></script>');
    writeFileSync(join(dist, 'assets/index-abc.js'), 'import("/assets/Lazy-def.js"); "/assets/logo-ghi.svg"');
    writeFileSync(join(dist, 'assets/Lazy-def.js'), '');
    writeFileSync(join(dist, 'assets/logo-ghi.svg'), '');
    writeFileSync(join(dist, 'assets/fonts/Cairo-jkl.woff2'), '');
    const out = execFileSync(join(root, 'scripts/web-file-list.sh'), [dist], { encoding: 'utf8' });
    expect(out.trim().split('\n')).toEqual([
      'assets/Lazy-def.js',
      'assets/fonts/Cairo-jkl.woff2',
      'assets/index-abc.js',
      'assets/logo-ghi.svg',
      'index.html',
    ]);
  });

  it('deploy-web.sh uploads _deploy/files.txt before index.html and never syncs with --delete', () => {
    const deploy = readFileSync(join(root, 'scripts/deploy-web.sh'), 'utf8');
    expect(deploy).not.toMatch(/s3 sync[^\n]*--delete/);
    expect(deploy).toContain('web-file-list.sh');
    const list = deploy.indexOf('_deploy/files.txt');
    const index = deploy.indexOf('dist/index.html "s3://');
    expect(list).toBeGreaterThan(0);
    expect(index).toBeGreaterThan(list);
  });

  it('prune removes only old keys outside the live file list: a lazy chunk and a logo named only in JS survive', () => {
    const bucket = mkdtempSync(join(tmpdir(), 'bucket-'));
    mkdirSync(join(bucket, '_deploy'));
    writeFileSync(
      join(bucket, '_deploy/files.txt'),
      ['assets/Lazy-def.js', 'assets/fonts/Cairo-jkl.woff2', 'assets/index-abc.js', 'assets/logo-ghi.svg', 'index.html'].join('\n') + '\n',
    );
    writeFileSync(join(bucket, 'index.html'), '<script src="/assets/index-abc.js"></script>');
    // everything "older than N days" per the fake listing: live files plus two leftovers from earlier builds
    writeFileSync(
      join(bucket, 'old-keys'),
      ['assets/Lazy-def.js', 'assets/fonts/Cairo-jkl.woff2', 'assets/index-abc.js', 'assets/logo-ghi.svg', 'assets/index-old.js', 'assets/Lazy-old.js'].join('\n'),
    );
    const bin = fakeAws(bucket);
    const out = run('scripts/prune-web-assets.sh', ['staging', '14'], bin);
    const log = readFileSync(join(bucket, 'log'), 'utf8').trim().split('\n').sort();
    expect(log).toEqual(['rm assets/Lazy-old.js', 'rm assets/index-old.js']);
    expect(out).toContain('removed 2');
  });

  it('prune refuses to delete anything when the file list is missing', () => {
    const bucket = mkdtempSync(join(tmpdir(), 'bucket-'));
    writeFileSync(join(bucket, 'old-keys'), 'assets/index-old.js');
    const bin = fakeAws(bucket);
    expect(() => run('scripts/prune-web-assets.sh', ['staging', '14'], bin)).toThrow(/files\.txt|status 1/);
    expect(() => readFileSync(join(bucket, 'log'))).toThrow();
  });
});
