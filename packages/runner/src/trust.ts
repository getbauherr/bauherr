import { matchesGlob } from 'node:path';

export const DIFF_BUDGET_LINES = 400;

type FileDiff = { path: string; deleted: boolean; added: string[]; removed: string[] };

const TEST_FILE = /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.\w+$/;
const CONFIG_FILE = /(^|\/)(vitest|playwright|jest)\.config\.\w+$|(^|\/)(eslint\.config\.\w+|\.eslintrc[\w.]*|biome\.jsonc?)$/;
const UNCOUNTED = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|composer\.lock|Cargo\.lock|poetry\.lock|payload-types\.ts)$|^docs\/features\.md$|(^|\/)migrations\/index\.ts$/;
const CASE = /^\s*(?:it|test|describe)(?:\.\w+)*\s*\(/;
const DISABLED = /\b(?:it|test|describe)\.(?:skip|only|todo|fixme)\b|\bx(?:it|test|describe)\s*\(|\b(?:fit|fdescribe)\s*\(/;
const SETTING = /^\s*['"]?([\w@/-]+)['"]?\s*:\s*\[?\s*['"]?(\d+|error|warn|off)['"]?/;
const COVERAGE_KEYS = new Set(['lines', 'functions', 'branches', 'statements']);
const SEVERITY: Record<string, number> = { off: 0, warn: 1, error: 2 };

export const isTestFile = (path: string): boolean => TEST_FILE.test(path);

export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: (FileDiff & { header: boolean; hunks: boolean }) | undefined;
  const lines = diff.split('\n');
  lines.forEach((line, i) => {
    if (line.startsWith('diff --git ')) {
      cur = { path: /\sb\/(.+)$/.exec(line)?.[1] ?? '', deleted: false, added: [], removed: [], header: false, hunks: false };
      files.push(cur);
    } else if (/^--- (a\/|\/dev\/null)/.test(line) && /^\+\+\+ (b\/|\/dev\/null)/.test(lines[i + 1] ?? '') && !cur?.hunks) {
      if (!cur || cur.header) {
        cur = { path: '', deleted: false, added: [], removed: [], header: false, hunks: false };
        files.push(cur);
      }
      const [from, to] = [line.slice(4).replace(/^a\//, ''), lines[i + 1]!.slice(4).replace(/^b\//, '')];
      cur.deleted = to === '/dev/null';
      cur.path = cur.deleted ? from : to;
      cur.header = true;
    } else if (cur && line.startsWith('@@')) {
      cur.hunks = true;
      if (/^@@ -\d+(,\d+)? \+0,0 @@/.test(line)) cur.deleted = true;
    } else if (cur?.hunks && line.startsWith('+')) cur.added.push(line.slice(1));
    else if (cur?.hunks && line.startsWith('-')) cur.removed.push(line.slice(1));
    else if (cur && line.startsWith('+++ ') && !cur.hunks) cur.header = true;
  });
  return files.filter((f) => f.path);
}

const count = (lines: string[], re: RegExp) => lines.filter((l) => re.test(l)).length;

const settings = (lines: string[]) => new Map(lines.flatMap((l) => { const m = SETTING.exec(l); return m ? [[m[1]!, m[2]!] as const] : []; }));

const loosened = (f: FileDiff): string[] => {
  const [was, now] = [settings(f.removed), settings(f.added)];
  const out: string[] = [];
  for (const [key, value] of now) {
    const before = was.get(key);
    if (key === 'retries' && /^\d+$/.test(value) && Number(value) > Number(before ?? 0)) out.push(`raises retries to ${value}`);
    if (before === undefined) continue;
    if (COVERAGE_KEYS.has(key) && /^\d+$/.test(value) && /^\d+$/.test(before) && Number(value) < Number(before)) out.push(`lowers the ${key} threshold from ${before} to ${value}`);
    if (before in SEVERITY && value in SEVERITY && SEVERITY[value]! < SEVERITY[before]!) out.push(`lowers ${key} from ${before} to ${value}`);
  }
  return out;
};

export function fakeGreenFindings(diff: string, plan = ''): string[] {
  const allowed = [...plan.matchAll(/^\s*Allowed:\s*remove tests\s+(\S+)/gim)].map((m) => m[1]!);
  const permitted = (path: string) => allowed.some((a) => a === path || matchesGlob(path, a));
  const out: string[] = [];
  for (const f of parseDiff(diff)) {
    if (isTestFile(f.path)) {
      const net = count(f.removed, CASE) - count(f.added, CASE);
      if (f.deleted && !permitted(f.path)) out.push(`${f.path}: deletes a test file (fake-green guard; the plan may allow it with "Allowed: remove tests ${f.path}")`);
      else if (net > 0 && !f.deleted && !permitted(f.path)) out.push(`${f.path}: removes ${net} test case(s) (fake-green guard; the plan may allow it with "Allowed: remove tests ${f.path}")`);
      const disabled = count(f.added, DISABLED) - count(f.removed, DISABLED);
      if (disabled > 0) out.push(`${f.path}: adds ${disabled} skipped, only or todo test(s) (fake-green guard)`);
    }
    if (CONFIG_FILE.test(f.path)) for (const m of loosened(f)) out.push(`${f.path}: ${m} (fake-green guard)`);
  }
  return out;
}

export function diffBudgetWarning(diff: string): string | undefined {
  const lines = parseDiff(diff).filter((f) => !UNCOUNTED.test(f.path) && !isTestFile(f.path)).reduce((n, f) => n + f.added.length + f.removed.length, 0);
  return lines > DIFF_BUDGET_LINES ? `Large diff (${lines} lines): split per the plan or say why in Evidence` : undefined;
}
