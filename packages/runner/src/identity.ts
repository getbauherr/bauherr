import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, sep } from 'node:path';
import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';

export const FIRST_RUN_UID = 10001;
export const RUN_SLOTS = 32;

export type Identity = { uid: number; gid: number };

const claimed = new Map<string, Identity>();

const isRoot = (): boolean => process.getuid?.() === 0;

export function claimIdentity(root: string): Identity | undefined {
  if (!isRoot()) return undefined;
  const taken = new Set([...claimed.values()].map((i) => i.uid));
  for (let uid = FIRST_RUN_UID; uid < FIRST_RUN_UID + RUN_SLOTS; uid++) {
    if (!taken.has(uid)) {
      const identity = { uid, gid: uid };
      claimed.set(root, identity);
      return identity;
    }
  }
  throw new Error(`all ${RUN_SLOTS} run identities are in use`);
}

export function releaseIdentity(root: string): void {
  claimed.delete(root);
}

const claimedFor = (path: string): Identity | undefined => {
  for (const [root, identity] of claimed) {
    if (path === root || path.startsWith(root + sep)) return identity;
  }
  return undefined;
};

export function runIdentity(path: string): Identity | undefined {
  if (!isRoot()) return undefined;
  const identity = claimedFor(path);
  if (!identity) throw new Error(`no run identity is claimed for ${path}`);
  return identity;
}

export const killRunProcesses = async (path: string): Promise<void> => {
  const identity = claimedFor(path);
  if (!identity) return;
  await new Promise<void>((resolve) => {
    const child = spawn('kill', ['-KILL', '--', '-1'], { stdio: 'ignore', ...identity });
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
};

export const spawnAsRunUser = ({ command, args, cwd, env, signal }: SpawnOptions): SpawnedProcess =>
  spawn(command, args, { cwd, env, signal, stdio: ['pipe', 'pipe', 'ignore'], ...runIdentity(cwd ?? '') });

const asRunUser = (path: string, command: string, args: string[], input?: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [input === undefined ? 'ignore' : 'pipe', 'ignore', 'ignore'],
      ...runIdentity(path),
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
    child.stdin?.end(input);
  });

export const mkdirAsRunUser = (path: string): Promise<void> =>
  runIdentity(path) ? asRunUser(path, 'mkdir', ['-p', path]) : mkdir(path, { recursive: true }).then(() => undefined);

export const writeFileAsRunUser = (path: string, content: string): Promise<void> =>
  runIdentity(path) ? asRunUser(path, 'tee', [path], content) : writeFile(path, content);

const AGENT_FILE_MAX_BYTES = 1024 * 1024;

export const readAgentFile = async (path: string): Promise<string | null> => {
  try {
    if (!(await lstat(dirname(path))).isDirectory()) return null;
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      return info.isFile() && info.size <= AGENT_FILE_MAX_BYTES ? await handle.readFile('utf8') : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
};
