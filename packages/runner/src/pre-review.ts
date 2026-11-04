import { matchesGlob } from 'node:path';

/** Per-Product, path-based rules checked before a Build requests review. No rule list (or an empty one) turns that check off. */
export type ReviewChecks = {
  tests?: { src: string[]; tests: string[] }[];
  schema?: { schema: string[]; migration: string[] }[];
  /** The `## Evidence` plan-step table needs a done/deferred row per plan step. */
  evidence?: boolean;
};

/** A Build whose MR-only diff has at least this many changed lines gets a self-review. */
export const SELF_REVIEW_MIN_LINES = 30;

/** Added plus deleted lines of `git diff --numstat` (binary files count 0). */
export const changedLines = (numstat: string): number =>
  numstat.split('\n').reduce((n, l) => n + (/^(\d+)\t(\d+)\t/.exec(l)?.slice(1).reduce((a, b) => a + Number(b), 0) ?? 0), 0);

/** Top-level numbered items under `## Steps` of a plan. */
export const planStepCount = (plan: string): number =>
  (/^##\s+Steps\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(plan)?.[1] ?? '').match(/^\d+\.\s/gm)?.length ?? 0;

const hit = (file: string, globs: string[]) => globs.some((g) => matchesGlob(file, g));

/** Failure lines (empty = pass). `exists` tells whether a repo path exists on the MR head. */
export function preReviewChecks(o: { files: string[]; evidence: string; planSteps: number; exists: (path: string) => boolean; config: ReviewChecks | null | undefined }): string[] {
  const { files, evidence, config } = o;
  if (!config) return [];
  const out: string[] = [];
  for (const r of config.tests ?? []) {
    const src = files.find((f) => hit(f, r.src) && !hit(f, r.tests));
    if (src && !files.some((f) => hit(f, r.tests))) out.push(`${src} changed but no file matching ${r.tests.join(', ')} did`);
    for (const t of new Set(evidence.match(/[\w.@-]+(?:\/[\w.@-]+)+\.\w+/g))) {
      if (hit(t, r.tests) && !files.includes(t) && !o.exists(t)) out.push(`Evidence names ${t}, which does not exist`);
    }
  }
  for (const r of config.schema ?? []) {
    const schema = files.find((f) => hit(f, r.schema));
    if (schema && !files.some((f) => hit(f, r.migration))) out.push(`${schema} changed but no file matching ${r.migration.join(', ')} did`);
  }
  if (config.evidence) {
    for (let n = 1; n <= o.planSteps; n++) {
      if (!new RegExp(`^\\|\\s*${n}\\b[^|]*\\|\\s*(done|deferred)\\b`, 'm').test(evidence)) out.push(`Evidence has no done/deferred row for plan step ${n}`);
    }
  }
  return out;
}

const list = (s: string) => s.split(',').map((g) => g.trim()).filter(Boolean);

/** One rule per line: `src/** => tests/**` (tests), `schema: collections.ts => migrations/**`, or `evidence`; globs comma-separated. Throws `line N: ...`. */
export function parseReviewChecks(text: string): ReviewChecks | null {
  const out: ReviewChecks = {};
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line === 'evidence') {
      out.evidence = true;
      return;
    }
    const m = /^(?:(tests|schema):\s*)?(.+?)\s*=>\s*(.+)$/.exec(line);
    const [left, right] = [list(m?.[2] ?? ''), list(m?.[3] ?? '')];
    if (!m || !left.length || !right.length) throw new Error(`line ${i + 1}: write "src/** => tests/**", "schema: a => b" or "evidence"`);
    if (m[1] === 'schema') (out.schema ??= []).push({ schema: left, migration: right });
    else (out.tests ??= []).push({ src: left, tests: right });
  });
  return Object.keys(out).length ? out : null;
}

export function formatReviewChecks(c: ReviewChecks | null | undefined): string {
  return [
    ...(c?.tests ?? []).map((r) => `${r.src.join(', ')} => ${r.tests.join(', ')}`),
    ...(c?.schema ?? []).map((r) => `schema: ${r.schema.join(', ')} => ${r.migration.join(', ')}`),
    ...(c?.evidence ? ['evidence'] : []),
  ].join('\n');
}
