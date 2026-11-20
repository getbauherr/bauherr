import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Stub = { url: string; seen: { headers: IncomingHttpHeaders; body: string }[]; close(): Promise<void> };

export type StubTool = { name: string; input: object };

export async function startStubGateway(
  text = 'done',
  port = 0,
  budgetExceeded = false,
  tool?: (model: string, prompt: string, cwd: string) => StubTool | undefined,
): Promise<Stub> {
  const seen: Stub['seen'] = [];
  let n = 0;
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ headers: req.headers, body });
      if (budgetExceeded) {
        res.writeHead(429, { 'content-type': 'application/json' }).end('{"error":{"code":"budget_exceeded"}}');
        return;
      }
      const id = `msg_stub_${++n}`;
      const parsed = (tool ? JSON.parse(body) : { model: '', messages: [] }) as { model: string; messages: unknown[] };
      const last = JSON.stringify(parsed.messages);
      const call = last.includes('tool_result')
        ? undefined
        : tool?.(parsed.model, last, /Primary working directory: ([^\\\s]+)/.exec(body)?.[1] ?? '');
      const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        ev('message_start', {
          message: {
            id,
            type: 'message',
            role: 'assistant',
            model: 'stub-model',
            content: [],
            stop_reason: null,
            usage: { input_tokens: 10, output_tokens: 1 },
          },
        }) +
          (call
            ? ev('content_block_start', {
                index: 0,
                content_block: { type: 'tool_use', id: `toolu_${n}`, name: call.name, input: {} },
              }) +
              ev('content_block_delta', {
                index: 0,
                delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input) },
              })
            : ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
              ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })) +
          ev('content_block_stop', { index: 0 }) +
          ev('message_delta', {
            delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null },
            usage: { output_tokens: 5 },
          }) +
          ev('message_stop', {}),
      );
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

export function makeBareRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'bauherr-bare-'));
  const bare = join(root, 'o/n.git');
  const work = join(root, 'work');
  mkdirSync(work);
  const g = (cwd: string, ...a: string[]) =>
    execFileSync('git', a, {
      cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    });
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'pipe' });
  g(work, 'init', '-b', 'main');
  writeFileSync(join(work, 'README.md'), 'hello\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-m', 'init');
  g(work, 'push', bare, 'main');
  return `file://${root}`;
}
