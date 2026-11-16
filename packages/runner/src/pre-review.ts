import { matchesGlob } from 'node:path';

/** Per-Product, path-based rules checked before a Build requests review. No rule list (or an empty one) turns that check off. */
export type ReviewChecks = {
  tests?: { src: string[]; tests: string[] }[];
  schema?: { schema: string[]; migration: string[] }[];
  /** The `## Evidence` plan-step table needs a done row, or a deferred row with a reason, per plan step. */
  evidence?: boolean;
  /** Commands the Evidence must show as run (exit code 0) on the pushed head, e.g. `pnpm typecheck`. */
  ran?: string[];
  /** Proof a human judges, per path rule (see `ArtifactRule`). */
  artifacts?: ArtifactRule[];
};

export const ARTIFACT_KINDS = ['image', 'recording', 'preview', 'transcript', 'sample', 'report'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** How a Product makes one kind of proof: when a changed path matches `globs`, `command` writes it into `.bauherr/artifacts/` (listed in `.bauherr/artifacts.json`); `before` also makes the image on the base branch. */
export type ArtifactRule = {
  name: string;
  globs: string[];
  kind: ArtifactKind;
  command: string;
  before?: boolean;
  /** Names a path set of the Product (`products.pathSets`) instead of `globs`; a set the Product has not declared matches nothing. */
  pathSet?: string;
  /** Image rules: each variant needs a `before` and an `after` image (`kind=image`, `pair`, title starting with the variant, e.g. `light-desktop: Settings`) on the pushed head. */
  pairs?: string[];
};

/** The rule every Product with a `ui` path set gets by default: a light and a dark desktop before/after pair. Attached by the agent (no command). */
export const UI_PROOF_RULE = 'UI change: before/after';
export const UI_PROOF_PAIRS = ['light-desktop', 'dark-desktop'];

/** The rules of a Product as the settings show them: the stored ones plus the default UI rule when the Product has a `ui` path set. */
export const proofRules = (config: ReviewChecks | null | undefined, sets: Record<string, string[]> | null | undefined): ArtifactRule[] => {
  const stored = config?.artifacts ?? [];
  const dflt: ArtifactRule = { name: UI_PROOF_RULE, globs: [], kind: 'image', command: '', pathSet: 'ui', pairs: UI_PROOF_PAIRS };
  return sets?.ui?.length && !stored.some((r) => r.name === UI_PROOF_RULE) ? [...stored, dflt] : stored;
};

/** The Product's checks as they are enforced: default rule added, path-set rules resolved to the set's globs. Null when nothing is configured. */
export const withProofDefaults = (config: ReviewChecks | null | undefined, sets: Record<string, string[]> | null | undefined): ReviewChecks | null => {
  const artifacts = proofRules(config, sets).map((r) => (r.pathSet ? { ...r, globs: sets?.[r.pathSet] ?? [] } : r));
  return artifacts.length ? { ...config, artifacts } : (config ?? null);
};

/** One proof as the Runner hands it to the server: a file (base64), a URL or text. */
export type ProofItem = { kind: ArtifactKind; title: string; criterion?: string; rule?: string; pair?: 'before' | 'after'; url?: string; text?: string; file?: { name: string; base64: string } };

/** Rule names are plain words without a colon, so the Evidence line `No artifact: <name>: <reason>` parses. */
const RULE_NAME = /^[\w .-]{1,60}$/;

/** The validated rules of the settings form as they are stored: the unmodified built-in UI rule stays code-defined and is dropped; a built-in row with another kind, path set or pairs throws `rule N: ...`. A command or `before` on it keeps it. */
export const storableProofRules = (rules: ArtifactRule[]): ArtifactRule[] =>
  rules.filter((r, i) => {
    if (r.name !== UI_PROOF_RULE) return true;
    if (r.kind !== 'image' || r.pathSet !== 'ui' || (r.pairs ?? []).join() !== UI_PROOF_PAIRS.join()) throw new Error(`rule ${i + 1}: the built-in rule "${UI_PROOF_RULE}" keeps its kind, path set and pairs`);
    return !!r.command || !!r.before;
  });

/** The rules of a settings form, validated; throws `rule N: ...`. */
export function artifactRules(v: unknown): ArtifactRule[] {
  if (!Array.isArray(v)) throw new Error('rules must be a list');
  return v.map((r: Record<string, unknown>, i) => {
    const bad = (m: string) => new Error(`rule ${i + 1}: ${m}`);
    const name = String(r.name ?? '').trim();
    const command = String(r.command ?? '').trim();
    const globs = (Array.isArray(r.globs) ? r.globs : String(r.globs ?? '').split(',')).map((g) => String(g).trim()).filter(Boolean);
    const pathSet = String(r.pathSet ?? '').trim();
    const pairs = (Array.isArray(r.pairs) ? r.pairs : String(r.pairs ?? '').split(',')).map((g) => String(g).trim()).filter(Boolean);
    if (name !== UI_PROOF_RULE && !RULE_NAME.test(name)) throw bad('name it with letters, digits, spaces, dots or dashes');
    if (pathSet && !/^[a-z][a-z0-9-]*$/.test(pathSet)) throw bad('pick a path set');
    if (!pathSet && !globs.length) throw bad('give at least one path glob or pick a path set');
    if (!(ARTIFACT_KINDS as readonly unknown[]).includes(r.kind)) throw bad('pick a kind');
    if (pairs.length && (r.kind !== 'image' || pairs.some((v) => !/^[\w-]+$/.test(v)))) throw bad('pairs are image variants such as light-desktop');
    if (!command && !pairs.length) throw bad('give the command that makes it');
    return { name, globs: pathSet ? [] : globs, kind: r.kind as ArtifactKind, command, ...(r.before && r.kind === 'image' ? { before: true } : {}), ...(pathSet ? { pathSet } : {}), ...(pairs.length ? { pairs } : {}) };
  });
}

/** `No artifact: <rule>: <reason>` Evidence lines: rule name to reason. With the Product's rule `names`, only those count and a name with a colon (the default `UI change: before/after`) is read whole: the longest name the line starts with, followed by a colon and a reason, wins. */
export const artifactWaivers = (evidence: string, names: string[] = []): Map<string, string> => {
  const out = new Map<string, string>();
  for (const m of evidence.matchAll(/^No artifact:\s*(.+)$/gm)) {
    const rest = m[1]!;
    const known = names.filter((n) => rest.startsWith(n) && /^\s*:\s*\S/.test(rest.slice(n.length))).sort((a, b) => b.length - a.length)[0];
    const hit = known ? [known, rest.slice(known.length).replace(/^\s*:\s*/, '')] : names.length ? undefined : /^([^:]+?)\s*:\s*(\S.*)$/.exec(rest)?.slice(1);
    if (hit) out.set(hit[0]!, hit[1]!.trim());
  }
  return out;
};

/** The rules whose globs match a changed file. */
export const matchingArtifactRules = (config: ReviewChecks | null | undefined, files: string[]): ArtifactRule[] =>
  (config?.artifacts ?? []).filter((r) => files.some((f) => r.globs.some((g) => matchesGlob(f, g))));

/** A Build whose MR-only diff has at least this many changed lines gets a self-review. */
export const SELF_REVIEW_MIN_LINES = 30;

/** Added plus deleted lines of `git diff --numstat` (binary files count 0). */
export const changedLines = (numstat: string): number =>
  numstat.split('\n').reduce((n, l) => n + (/^(\d+)\t(\d+)\t/.exec(l)?.slice(1).reduce((a, b) => a + Number(b), 0) ?? 0), 0);

/** Top-level numbered items under `## Steps` of a plan. */
export const planStepCount = (plan: string): number =>
  (/^##\s+Steps\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(plan)?.[1] ?? '').match(/^\d+\.\s/gm)?.length ?? 0;

/** Whether an image proof's title names `variant`: the title starts with it (case-insensitive) and the variant is followed by the end, whitespace or punctuation, never by a letter, digit, `_` or `-` (so `light-desktop-old` is another variant). */
export const titleNamesVariant = (title: string, variant: string): boolean => {
  const t = title.trim().toLowerCase();
  const v = variant.toLowerCase();
  return t.startsWith(v) && !/^[\p{L}\p{N}_-]/u.test(t.slice(v.length));
};

const hit = (file: string, globs: string[]) => globs.some((g) => matchesGlob(file, g));

/** Failure lines (empty = pass). `exists` tells whether a repo path exists on the MR head. */
export function preReviewChecks(o: { files: string[]; evidence: string; planSteps: number; headSha?: string; /** Names of the artifact rules that have proof on the head. */ artifacts?: string[]; /** `kind=image` proof with a `pair` on the head, for rules with `pairs`. */ images?: { rule?: string; title: string; pair?: string }[]; exists: (path: string) => boolean; config: ReviewChecks | null | undefined }): string[] {
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
  const waived = artifactWaivers(evidence, (config.artifacts ?? []).map((r) => r.name));
  for (const r of matchingArtifactRules(config, files)) {
    if (Array.isArray(r.pairs) && r.pairs.length) {
      const have = (o.images ?? []).filter((i) => i.rule === r.name && i.pair);
      const missing = r.pairs.flatMap((v) => (['before', 'after'] as const).filter((side) => !have.some((i) => i.pair === side && titleNamesVariant(i.title, v))).map((side) => `${v} ${side}`));
      if (missing.length && !waived.has(r.name)) out.push(`No before/after pair "${r.name}" on the pushed head, missing: ${missing.join(', ')}. Attach each (attach_artifact, kind image, rule "${r.name}", pair before|after, title starting with the variant, e.g. "${r.pairs[0]}: <view>"), or add the Evidence line "No artifact: ${r.name}: <reason>"`);
      continue;
    }
    if (!o.artifacts?.includes(r.name) && !waived.has(r.name)) out.push(`No proof "${r.name}" (${r.kind}) on the pushed head: run \`${r.command}\`, attach it (attach_artifact, rule "${r.name}"), or add the Evidence line "No artifact: ${r.name}: <reason>"`);
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
