import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type Clone = { dir: string; branch: string; baseSha: string; cleanup(): Promise<void> };

/** Env for the Runner's own git commands only; the token never reaches the agent env or .git/config. */
export function gitEnv(token: string, home: string, user = 'x-access-token'): NodeJS.ProcessEnv {
  const basic = Buffer.from(`${user}:${token}`).toString('base64');
  return {
    PATH: process.env.PATH,
    HOME: home,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Bauherr',
    GIT_AUTHOR_EMAIL: 'bauherr@users.noreply.invalid',
    GIT_COMMITTER_NAME: 'Bauherr',
    GIT_COMMITTER_EMAIL: 'bauherr@users.noreply.invalid',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

export function git(dir: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<string> {
  return exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, env }).then((r) => r.stdout.trim());
}

export async function cloneRepo(o: { baseUrl: string; repo: string; defaultBranch: string; token: string; user?: string; branch: string; checkout?: string }): Promise<Clone & { env: NodeJS.ProcessEnv; home: string }> {
  const root = await mkdtemp(join(tmpdir(), 'bauherr-run-'));
  const dir = join(root, 'repo');
  const home = join(root, 'home');
  const env = gitEnv(o.token, home, o.user);
  const cleanup = () => rm(root, { recursive: true, force: true });
  try {
    await exec('mkdir', ['-p', home]);
    const url = `${o.baseUrl.replace(/\/$/, '')}/${o.repo}.git`;
    await git(root, env, 'clone', '--depth', '50', '--no-tags', '--branch', o.checkout ?? o.defaultBranch, url, dir);
    if (!o.checkout) await git(dir, env, 'switch', '-c', o.branch);
    const baseSha = await git(dir, env, 'rev-parse', 'HEAD');
    return { dir, branch: o.checkout ?? o.branch, baseSha, cleanup, env, home };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

/** Fetches the base (full history, so a merge base exists), then merges it into HEAD without an agent. A conflict leaves the merge in progress in the tree. */
export async function mergeBase(c: Clone, env: NodeJS.ProcessEnv, base: string): Promise<'uptodate' | 'clean' | 'conflict'> {
  const shallow = (await git(c.dir, env, 'rev-parse', '--is-shallow-repository')) === 'true';
  await git(c.dir, env, 'fetch', ...(shallow ? ['--unshallow'] : []), '--no-tags', 'origin', `${base}:refs/remotes/origin/${base}`);
  try {
    return (await git(c.dir, env, 'merge', '--no-edit', `origin/${base}`)).includes('Already up to date') ? 'uptodate' : 'clean';
  } catch (e) {
    if ((await git(c.dir, env, 'diff', '--name-only', '--diff-filter=U')) !== '') return 'conflict';
    throw e;
  }
}

/** Stable patch-id of the MR-only diff (merge base of `origin/<base>` to `rev`); equal ids mean the same change regardless of main's movement. Empty for an empty diff. */
export async function patchId(c: Clone, env: NodeJS.ProcessEnv, base: string, rev = 'HEAD'): Promise<string> {
  const range = `${await git(c.dir, env, 'merge-base', `origin/${base}`, rev)}..${rev}`;
  const { stdout } = await exec('sh', ['-c', 'git diff "$0" | git patch-id --stable', range], { cwd: c.dir, env, maxBuffer: 1 << 28 });
  return stdout.split(' ')[0]!.trim();
}

/** Writes the difference between the MR-only diff at `reviewedSha` and at HEAD to `out`; falls back to the full MR-only diff when `reviewedSha` is not in the clone. */
export async function interdiff(c: Clone, env: NodeJS.ProcessEnv, base: string, reviewedSha: string, out: string): Promise<void> {
  if (!(await git(c.dir, env, 'cat-file', '-t', reviewedSha).catch(() => ''))) {
    await git(c.dir, env, 'diff', `--output=${out}`, `origin/${base}...HEAD`);
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), 'bauherr-interdiff-'));
  try {
    for (const [file, rev] of [['reviewed.patch', reviewedSha], ['head.patch', 'HEAD']] as const) {
      await git(c.dir, env, 'diff', `--output=${join(dir, file)}`, `${await git(c.dir, env, 'merge-base', `origin/${base}`, rev)}..${rev}`);
    }
    await git(c.dir, env, 'diff', '--no-index', `--output=${out}`, join(dir, 'reviewed.patch'), join(dir, 'head.patch')).catch((e) => {
      if (e.code !== 1) throw e;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Commits all changes; false when the branch has no commit beyond where it started. */
export async function commitAll(c: Clone, env: NodeJS.ProcessEnv, message: string): Promise<boolean> {
  await git(c.dir, env, 'add', '-A');
  if ((await git(c.dir, env, 'status', '--porcelain')) !== '') await git(c.dir, env, 'commit', '-m', message);
  return (await git(c.dir, env, 'rev-parse', 'HEAD')) !== c.baseSha;
}

/** Commit leftover changes and push; returns false when the agent produced no commits. */
export async function commitAndPush(c: Clone, env: NodeJS.ProcessEnv, message: string): Promise<boolean> {
  if (!(await commitAll(c, env, message))) return false;
  await git(c.dir, env, 'push', 'origin', `HEAD:refs/heads/${c.branch}`);
  return true;
}
