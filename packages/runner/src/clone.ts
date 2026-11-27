import { execFile } from 'node:child_process';
import { appendFile, chmod, chown, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { claimIdentity, killRunProcesses, releaseIdentity, runIdentity } from './identity.js';

const exec = promisify(execFile);

export const WORK_DIR = '.bauherr';

export type Clone = { dir: string; branch: string; baseSha: string; cleanup(): Promise<void> };

const authHeader = (token: string, user: string): string =>
  `Authorization: Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;

const AUTH = 'BAUHERR_GIT_AUTH';
const NETWORK = new Set(['clone', 'fetch', 'push']);
const HARDENING = [
  '--no-optional-locks',
  ...[
    'core.fsmonitor=false',
    'core.hooksPath=/dev/null',
    'core.sshCommand=ssh',
    'core.pager=cat',
    'core.attributesFile=/dev/null',
    'credential.helper=',
    'protocol.ext.allow=never',
  ].flatMap((setting) => ['-c', setting]),
];

const configs = new Map<string, string>();

export function useToken(c: { env: NodeJS.ProcessEnv }, token: string, user = 'x-access-token'): void {
  c.env[AUTH] = authHeader(token, user);
}

export function gitEnv(token: string, home: string, user = 'x-access-token'): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: home,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL ?? '/dev/null',
    GIT_AUTHOR_NAME: 'Bauherr',
    GIT_AUTHOR_EMAIL: 'bauherr@users.noreply.invalid',
    GIT_COMMITTER_NAME: 'Bauherr',
    GIT_COMMITTER_EMAIL: 'bauherr@users.noreply.invalid',
    [AUTH]: authHeader(token, user),
  };
}

const envFor = (env: NodeJS.ProcessEnv, network: boolean): NodeJS.ProcessEnv => {
  const { [AUTH]: header, ...rest } = env;
  return network && header
    ? { ...rest, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraheader', GIT_CONFIG_VALUE_0: header }
    : rest;
};

async function restoreConfig(dir: string): Promise<void> {
  const snapshot = configs.get(dir);
  if (snapshot === undefined) return;
  const gitDir = join(dir, '.git');
  if (!(await lstat(gitDir)).isDirectory()) throw new Error('the checkout lost its .git directory');
  await Promise.all(['config', 'config.worktree', 'commondir'].map((name) => rm(join(gitDir, name), { force: true })));
  await writeFile(join(gitDir, 'config'), snapshot, { flag: 'wx', mode: 0o644 });
}

async function run(dir: string, env: NodeJS.ProcessEnv, args: string[]): Promise<string> {
  await restoreConfig(dir);
  const options = { cwd: dir, env: envFor(env, NETWORK.has(args[0] ?? '')), maxBuffer: 1 << 28, ...runIdentity(dir) };
  return (await exec('git', [...HARDENING, ...args], options)).stdout;
}

export const git = async (dir: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<string> =>
  (await run(dir, env, args)).trim();

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
  const cleanup = async () => {
    configs.delete(dir);
    try {
      await killRunProcesses(root);
    } finally {
      releaseIdentity(root);
      await rm(root, { recursive: true, force: true });
    }
  };
  try {
    const owner = claimIdentity(root);
    await mkdir(home);
    await chmod(root, 0o700);
    if (owner) await Promise.all([root, home].map((path) => chown(path, owner.uid, owner.gid)));
    const url = `${o.baseUrl.replace(/\/$/, '')}/${o.repo}.git`;
    await git(root, env, 'clone', '--depth', '50', '--no-tags', '--branch', o.checkout ?? o.defaultBranch, url, dir);
    if (!o.checkout) await git(dir, env, 'switch', '-c', o.branch);
    await appendFile(join(dir, '.git/info/exclude'), `\n/${WORK_DIR}/\n`);
    const baseSha = await git(dir, env, 'rev-parse', 'HEAD');
    configs.set(dir, await readFile(join(dir, '.git/config'), 'utf8'));
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
  const diff = await run(c.dir, env, ['diff', '--no-ext-diff', '--no-textconv', range]);
  const child = exec('git', [...HARDENING, 'patch-id', '--stable'], {
    cwd: c.dir,
    env: envFor(env, false),
    ...runIdentity(c.dir),
  });
  child.child.stdin?.end(diff);
  return (await child).stdout.split(' ')[0].trim();
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
