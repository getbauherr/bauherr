import { execFile } from 'node:child_process';
import { appendFile, chown, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { runIdentity } from './identity.js';

const exec = promisify(execFile);

export const WORK_DIR = '.bauherr';

export type Clone = { dir: string; branch: string; baseSha: string; cleanup(): Promise<void> };

const authHeader = (token: string, user: string): string =>
  `Authorization: Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;

export function useToken(c: { env: NodeJS.ProcessEnv }, token: string, user = 'x-access-token'): void {
  c.env.GIT_CONFIG_VALUE_0 = authHeader(token, user);
}

export function gitEnv(token: string, home: string, user = 'x-access-token'): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: home,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Bauherr',
    GIT_AUTHOR_EMAIL: 'bauherr@users.noreply.invalid',
    GIT_COMMITTER_NAME: 'Bauherr',
    GIT_COMMITTER_EMAIL: 'bauherr@users.noreply.invalid',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraheader',
    GIT_CONFIG_VALUE_0: authHeader(token, user),
  };
}

export function git(dir: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<string> {
  const options = { cwd: dir, env, ...runIdentity() };
  return exec('git', ['-c', 'core.hooksPath=/dev/null', ...args], options).then((r) => r.stdout.trim());
}

export async function cloneRepo(o: {
  baseUrl: string;
  repo: string;
  defaultBranch: string;
  token: string;
  user?: string;
  branch: string;
  checkout?: string;
}): Promise<Clone & { env: NodeJS.ProcessEnv; home: string }> {
  const root = await mkdtemp(join(tmpdir(), 'bauherr-run-'));
  const dir = join(root, 'repo');
  const home = join(root, 'home');
  const env = gitEnv(o.token, home, o.user);
  const cleanup = () => rm(root, { recursive: true, force: true });
  try {
    await mkdir(home);
    const owner = runIdentity();
    if (owner) await Promise.all([root, home].map((path) => chown(path, owner.uid, owner.gid)));
    const url = `${o.baseUrl.replace(/\/$/, '')}/${o.repo}.git`;
    await git(root, env, 'clone', '--depth', '50', '--no-tags', '--branch', o.checkout ?? o.defaultBranch, url, dir);
    if (!o.checkout) await git(dir, env, 'switch', '-c', o.branch);
    await appendFile(join(dir, '.git/info/exclude'), `\n/${WORK_DIR}/\n`);
    const baseSha = await git(dir, env, 'rev-parse', 'HEAD');
    return { dir, branch: o.checkout ?? o.branch, baseSha, cleanup, env, home };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

export async function fetchBase(c: Clone, env: NodeJS.ProcessEnv, base: string): Promise<void> {
  const shallow = (await git(c.dir, env, 'rev-parse', '--is-shallow-repository')) === 'true';
  await git(
    c.dir,
    env,
    'fetch',
    ...(shallow ? ['--unshallow'] : []),
    '--no-tags',
    'origin',
    `${base}:refs/remotes/origin/${base}`,
  );
}

export async function mergeBase(
  c: Clone,
  env: NodeJS.ProcessEnv,
  base: string,
): Promise<'uptodate' | 'clean' | 'conflict'> {
  await fetchBase(c, env, base);
  try {
    return (await git(c.dir, env, 'merge', '--no-edit', `origin/${base}`)).includes('Already up to date')
      ? 'uptodate'
      : 'clean';
  } catch (e) {
    if ((await git(c.dir, env, 'diff', '--name-only', '--diff-filter=U')) !== '') return 'conflict';
    throw e;
  }
}

export async function patchId(c: Clone, env: NodeJS.ProcessEnv, base: string, rev = 'HEAD'): Promise<string> {
  const range = `${await git(c.dir, env, 'merge-base', `origin/${base}`, rev)}..${rev}`;
  const { stdout } = await exec('sh', ['-c', 'git diff "$0" | git patch-id --stable', range], {
    cwd: c.dir,
    env,
    maxBuffer: 1 << 28,
    ...runIdentity(),
  });
  return stdout.split(' ')[0].trim();
}

export async function commitAll(c: Clone, env: NodeJS.ProcessEnv, message: string): Promise<boolean> {
  await git(c.dir, env, 'add', '-A');
  if ((await git(c.dir, env, 'status', '--porcelain')) !== '') await git(c.dir, env, 'commit', '-m', message);
  return (await git(c.dir, env, 'rev-parse', 'HEAD')) !== c.baseSha;
}

export async function commitAndPush(
  c: Clone,
  env: NodeJS.ProcessEnv,
  message: string,
  options: { onlyIfHeadStillAtStart?: boolean } = {},
): Promise<boolean> {
  if (!(await commitAll(c, env, message))) return false;
  const guard = options.onlyIfHeadStillAtStart ? [`--force-with-lease=refs/heads/${c.branch}:${c.baseSha}`] : [];
  await git(c.dir, env, 'push', ...guard, 'origin', `HEAD:refs/heads/${c.branch}`);
  return true;
}
