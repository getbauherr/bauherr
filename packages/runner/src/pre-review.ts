import { matchesGlob } from 'node:path';

/** Per-Product, path-based rules checked before a Build requests review. No rule list (or an empty one) turns that check off. */
export type ReviewChecks = {
  tests?: { src: string[]; tests: string[] }[];
  schema?: { schema: string[]; migration: string[] }[];
  /** The `## Evidence` plan-step table needs a done row, or a deferred row with a reason, per plan step. */
  evidence?: boolean;
  /** Commands the Evidence must show as run (exit code 0) on the pushed head, e.g. `pnpm typecheck`. */
  ran?: string[];
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
export function preReviewChecks(o: { files: string[]; evidence: string; planSteps: number; headSha?: string; exists: (path: string) => boolean; config: ReviewChecks | null | undefined }): string[] {
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
  if (config.ran?.length) {
    for (const cmd of config.ran) {
      const line = evidence.split('\n').find((l) => l.includes(cmd) && /\bexit(?:\s*code)?\s*[:=]?\s*0\b/i.test(l));
      if (!line) out.push(`Evidence does not show \`${cmd}\` with exit code 0`);
    }
    const sha = o.headSha?.slice(0, 7);
    if (sha && !evidence.includes(sha)) out.push(`Evidence does not name the pushed head ${sha}; run the checks on the pushed commit and record its SHA`);
  }
  if (config.evidence) {
    for (let n = 1; n <= o.planSteps; n++) {
      const row = new RegExp(`^\\|\\s*${n}\\b[^|]*\\|\\s*(done|deferred)\\b[^|]*\\|([^|\\n]*)\\|`, 'm').exec(evidence);
      if (!row) out.push(`Evidence has no done/deferred row for plan step ${n}`);
      else if (row[1] === 'deferred' && /^[\s-]*$/.test(row[2]!)) out.push(`Evidence defers plan step ${n} without a reason`);
    }
  }
  return out;
}

const list = (s: string) => s.split(',').map((g) => g.trim()).filter(Boolean);

/** One rule per line: `src/** => tests/**` (tests), `schema: collections.ts => migrations/**`, `ran: pnpm test` (the Evidence shows it with exit code 0 and the pushed SHA), or `evidence`; globs comma-separated. Throws `line N: ...`. */
export function parseReviewChecks(text: string): ReviewChecks | null {
  const out: ReviewChecks = {};
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line === 'evidence') {
      out.evidence = true;
      return;
    }
    const ran = /^ran:\s*(.+)$/.exec(line);
    if (ran) {
      (out.ran ??= []).push(ran[1]!.trim());
      return;
    }
    const m = /^(?:(tests|schema):\s*)?(.+?)\s*=>\s*(.+)$/.exec(line);
    const [left, right] = [list(m?.[2] ?? ''), list(m?.[3] ?? '')];
    if (!m || !left.length || !right.length) throw new Error(`line ${i + 1}: write "src/** => tests/**", "schema: a => b", "ran: <command>" or "evidence"`);
    if (m[1] === 'schema') (out.schema ??= []).push({ schema: left, migration: right });
    else (out.tests ??= []).push({ src: left, tests: right });
  });
  return Object.keys(out).length ? out : null;
}

export function formatReviewChecks(c: ReviewChecks | null | undefined): string {
  return [
    ...(c?.tests ?? []).map((r) => `${r.src.join(', ')} => ${r.tests.join(', ')}`),
    ...(c?.schema ?? []).map((r) => `schema: ${r.schema.join(', ')} => ${r.migration.join(', ')}`),
    ...(c?.ran ?? []).map((cmd) => `ran: ${cmd}`),
    ...(c?.evidence ? ['evidence'] : []),
  ].join('\n');
}
