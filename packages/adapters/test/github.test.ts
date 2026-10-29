import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GithubBackend, patAuth } from '../src/index.js';
import { contractSuite } from './contract.js';

const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('set GITHUB_TOKEN (e.g. $(gh auth token))');

const API = 'https://api.github.com';
const SANDBOX = 'getbauherr/sandbox';
const READ_ONLY = 'getbauherr/bauherr';
const backend = new GithubBackend({ auth: patAuth(token) });
const gh = (method: string, path: string, body?: unknown) =>
  fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'bauherr-test' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const login: string = ((await (await gh('GET', '/user')).json()) as { login: string }).login;

describe('github: read-only against getbauherr/bauherr', () => {
  const ts = backend.tickets(READ_ONLY);
  it('frontier of #1 is a list of open, unblocked sub-tickets', async () => {
    const f = await ts.frontier('1');
    assert.ok(Array.isArray(f));
    assert.ok(f.every((s) => s.state === 'open'));
    console.log(`frontier(#1): ${f.map((s) => s.number).join(',') || 'empty'}`);
  });
  it('polls since yesterday, no PRs', async () => {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { changes, next } = await ts.poll(since);
    assert.ok(changes.every((c) => c.url.includes('/issues/') && c.updatedAt >= since.replace(/\.\d{3}Z$/, 'Z')));
    assert.ok(changes.length === 0 || next === changes.at(-1)!.updatedAt);
  });
  it('null cursor returns every issue incl. closed', async () => {
    const { changes } = await ts.poll(null);
    assert.ok(changes.length > 0);
  });
  it('lists pull requests', async () => {
    const prs = await backend.forge.listPullRequests(READ_ONLY, 'all');
    assert.ok(Array.isArray(prs));
    assert.ok(prs.every((p) => ['open', 'closed', 'merged'].includes(p.state)));
  });
  it('get() on a sub-ticket reports its parent', async () => {
    const [child] = await ts.listSubTickets('1');
    if (child) assert.equal((await ts.get(child.id)).parent, '1');
  });
});

contractSuite('github sandbox', {
  backend, repo: SANDBOX, user: login,
  async commitFile(branch, path, content) {
    const res = await gh('PUT', `/repos/${SANDBOX}/contents/${path}`, { message: 'contract: add file', content: Buffer.from(content).toString('base64'), branch });
    assert.equal(res.status, 201);
  },
  async cleanup({ tickets, branches, prs, labels }) {
    for (const n of prs) await gh('PATCH', `/repos/${SANDBOX}/pulls/${n}`, { state: 'closed' });
    for (const n of tickets) await gh('PATCH', `/repos/${SANDBOX}/issues/${n}`, { state: 'closed', state_reason: 'not_planned' });
    for (const b of branches) await gh('DELETE', `/repos/${SANDBOX}/git/refs/heads/${b}`);
    for (const l of [...labels, 'bauherr:test', 'bauherr:a', 'bauherr:b', 'keep', 'bauherr:approved:plan', 'bauherr:stage:plan', 'bauherr:stage:build']) {
      await gh('DELETE', `/repos/${SANDBOX}/labels/${encodeURIComponent(l)}`);
    }
  },
});
