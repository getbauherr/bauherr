import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { git } from './clone.js';
import { egressGuard } from './guards.js';
import { ARTIFACT_KINDS, type ArtifactKind, type ArtifactRule, type ProofItem } from './pre-review.js';

const exec = promisify(execFile);

export type { ProofItem };
export const ARTIFACTS_DIR = '.bauherr/artifacts';
export const ARTIFACTS_MANIFEST = '.bauherr/artifacts.json';

const MAX_ITEMS = 40;
const MAX_FILE = 25 * 1024 * 1024;
const COMMAND_MS = 5 * 60_000;

/** Reads `.bauherr/artifacts.json` of `dir`: entries `{file|url|text, kind, title, criterion?, rule?, pair?}`; a file must lie inside `.bauherr/artifacts/` (symlinks resolved), anything unreadable or malformed is skipped. */
export function readManifest(dir: string, force?: Partial<ProofItem>): ProofItem[] {
  const manifest = join(dir, ARTIFACTS_MANIFEST);
  if (!existsSync(manifest)) return [];
  let list: unknown;
  try {
    list = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const root = existsSync(join(dir, ARTIFACTS_DIR)) ? realpathSync(join(dir, ARTIFACTS_DIR)) : null;
  const out: ProofItem[] = [];
  for (const e of list.slice(0, MAX_ITEMS) as Record<string, unknown>[]) {
    if (!(ARTIFACT_KINDS as readonly unknown[]).includes(e.kind) || typeof e.title !== 'string' || !e.title.trim()) continue;
    const item: ProofItem = { kind: e.kind as ArtifactKind, title: e.title.trim().slice(0, 200), ...(typeof e.criterion === 'string' && { criterion: e.criterion }), ...(typeof e.rule === 'string' && { rule: e.rule }), ...(e.pair === 'before' || e.pair === 'after' ? { pair: e.pair } : {}), ...force };
    if (typeof e.url === 'string') item.url = e.url;
    else if (typeof e.text === 'string') item.text = e.text;
    else if (typeof e.file === 'string' && root) {
      try {
        const path = realpathSync(resolve(root, e.file));
        const rel = relative(root, path);
        if (rel.startsWith('..') || isAbsolute(rel) || statSync(path).size > MAX_FILE) continue;
        item.file = { name: e.file.split('/').pop()!, base64: readFileSync(path).toString('base64') };
      } catch {
        continue;
      }
    } else continue;
    out.push(item);
  }
  return out;
}

const run = async (cmd: string, cwd: string, gatewayHost: string, rule: ArtifactRule, pair?: string): Promise<string | null> => {
  const d = egressGuard('Bash', { command: cmd }, gatewayHost);
  if (!d.allow) return d.reason;
  try {
    await exec('sh', ['-c', cmd], { cwd, timeout: COMMAND_MS, maxBuffer: 1 << 24, env: { PATH: process.env.PATH, HOME: process.env.HOME, BAUHERR_ARTIFACTS_DIR: join(cwd, ARTIFACTS_DIR), BAUHERR_ARTIFACT_RULE: rule.name, ...(pair ? { BAUHERR_ARTIFACT_PAIR: pair } : {}) } as NodeJS.ProcessEnv });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.slice(0, 300) : String(e);
  }
};

/**
 * Makes the proof of the matching rules after the last edit: runs each rule's command in the clone (the egress guard applies, no forge credentials in its environment), then reads the manifest.
 * A rule with `before` runs a second time in a clean checkout of the base branch with `BAUHERR_ARTIFACT_PAIR=before`. A failing command leaves its rule without proof, which the pre-review check then reports.
 */
export async function makeProof(o: { dir: string; env: NodeJS.ProcessEnv; base: string; rules: ArtifactRule[]; gatewayHost: string; log: (m: string) => void }): Promise<ProofItem[]> {
  const items: ProofItem[] = [];
  for (const rule of o.rules) {
    const fail = await run(rule.command, o.dir, o.gatewayHost, rule, rule.before ? 'after' : undefined);
    if (fail) o.log(`artifact rule "${rule.name}" failed: ${fail}`);
    items.push(...readManifest(o.dir).filter((i) => i.rule === rule.name).map((i) => (rule.before && i.kind === 'image' ? { ...i, pair: i.pair ?? ('after' as const) } : i)));
    if (!rule.before) continue;
    const root = await mkdtemp(join(tmpdir(), 'bauherr-before-'));
    const tree = join(root, 'base');
    try {
      await git(o.dir, o.env, 'worktree', 'add', '--detach', tree, `origin/${o.base}`);
      const failed = await run(rule.command, tree, o.gatewayHost, rule, 'before');
      if (failed) o.log(`artifact rule "${rule.name}" (before) failed: ${failed}`);
      items.push(...readManifest(tree, { pair: 'before' }).filter((i) => i.rule === rule.name));
    } catch (e) {
      o.log(`artifact rule "${rule.name}" (before): ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await git(o.dir, o.env, 'worktree', 'remove', '--force', tree).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }
  return items.slice(0, MAX_ITEMS);
}
