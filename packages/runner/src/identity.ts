import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';

export const RUN_UID = 10001;
export const RUN_GID = 10001;

export const runIdentity = (): { uid: number; gid: number } | undefined =>
  process.getuid?.() === 0 ? { uid: RUN_UID, gid: RUN_GID } : undefined;

export const spawnAsRunUser = ({ command, args, cwd, env, signal }: SpawnOptions): SpawnedProcess =>
  spawn(command, args, { cwd, env, signal, stdio: ['pipe', 'pipe', 'ignore'], ...runIdentity() });

const asRunUser = (command: string, args: string[], input?: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [input === undefined ? 'ignore' : 'pipe', 'ignore', 'ignore'],
      ...runIdentity(),
    });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
    child.stdin?.end(input);
  });

export const mkdirAsRunUser = (path: string): Promise<void> =>
  runIdentity() ? asRunUser('mkdir', ['-p', path]) : mkdir(path, { recursive: true }).then(() => undefined);

export const writeFileAsRunUser = (path: string, content: string): Promise<void> =>
  runIdentity() ? asRunUser('tee', [path], content) : writeFile(path, content);

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
