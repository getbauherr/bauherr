import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RunCtx } from '../src/types.js';

export const PACK_DIR = resolve(import.meta.dirname, '../../../../pack');

export type Stub = { url: string; seen: { headers: IncomingHttpHeaders; body: string }[]; close(): Promise<void> };

/** Plays the gateway: answers every /v1/messages with a minimal streamed end_turn message. */
export async function startStubGateway(text = 'done'): Promise<Stub> {
  const seen: Stub['seen'] = [];
  let n = 0;
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ headers: req.headers, body });
      const id = `msg_stub_${++n}`;
      const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        ev('message_start', { message: { id, type: 'message', role: 'assistant', model: 'stub-model', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } }) +
          ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
          ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }) +
          ev('content_block_stop', { index: 0 }) +
          ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) +
          ev('message_stop', {}),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

/** Bare repo `<root>/o/n.git` with one commit on `main`; returns the file:// base URL. */
export function makeBareRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'bauherr-bare-'));
  const bare = join(root, 'o/n.git');
  const work = join(root, 'work');
  mkdirSync(work);
  const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'pipe' });
  g(work, 'init', '-b', 'main');
  writeFileSync(join(work, 'README.md'), 'hello\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-m', 'init');
  g(work, 'push', bare, 'main');
  return `file://${root}`;
}

export function makeCtx(over: Partial<RunCtx> & { gatewayUrl: string; gitBaseUrl: string; stage?: 'plan' | 'build' }): RunCtx & { logs: string[]; comments: string[]; prs: { head: string; body: string }[] } {
  const logs: string[] = [];
  const comments: string[] = [];
  const prs: { head: string; body: string }[] = [];
  return {
    run: { id: 'r1', stage: over.stage ?? 'plan', goal: { statements: ['plan posted'] }, maxTurns: 5, maxBudgetUsd: 1, tier: 'cheap' },
    ticket: { number: 7, url: 'https://example.invalid/7', title: 'T', body: 'body' },
    product: { repo: 'o/n', defaultBranch: 'main' },
    connection: { gatewayUrl: over.gatewayUrl, gatewayKey: 'REAL-GATEWAY-KEY', gitToken: 'GIT-TOKEN', modelByTier: { cheap: 'stub-model' }, gitBaseUrl: over.gitBaseUrl },
    forge: {
      async openPullRequest(p) { prs.push({ head: p.head, body: p.body }); return { url: 'https://example.invalid/pr/1' }; },
      async comment(_n, b) { comments.push(b); },
    },
    recorder: { async step() {}, async toolCall() {}, log: (m) => logs.push(m) },
    packDir: PACK_DIR,
    logs, comments, prs,
  };
}
