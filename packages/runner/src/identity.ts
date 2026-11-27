import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
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
