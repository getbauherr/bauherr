import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type Clone = { dir: string; branch: string; baseSha: string; cleanup(): Promise<void> };

/** Env for the Runner's own git commands only; the token never reaches the agent env or .git/config. */
export function gitEnv(token: string, home: string): NodeJS.ProcessEnv {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
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

export async function cloneRepo(o: { baseUrl: string; repo: string; defaultBranch: string; token: string; branch: string; checkout?: string }): Promise<Clone & { env: NodeJS.ProcessEnv; home: string }> {
  const root = await mkdtemp(join(tmpdir(), 'bauherr-run-'));
  const dir = join(root, 'repo');
  const home = join(root, 'home');
  const env = gitEnv(o.token, home);
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

/** Commit leftover changes and push; returns false when the agent produced no commits. */
export async function commitAndPush(c: Clone, env: NodeJS.ProcessEnv, message: string): Promise<boolean> {
  await git(c.dir, env, 'add', '-A');
  if ((await git(c.dir, env, 'status', '--porcelain')) !== '') await git(c.dir, env, 'commit', '-m', message);
  if ((await git(c.dir, env, 'rev-parse', 'HEAD')) === c.baseSha) return false;
  await git(c.dir, env, 'push', 'origin', `HEAD:refs/heads/${c.branch}`);
  return true;
}
