import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Conflict, GithubBackend, patAuth } from '../src/index.js';
import { type Wire } from '../src/wire.js';
import { bodyOf, json, urlOf } from './helpers.js';

void describe('github file requests', () => {
  type Call = { method: string; url: string; body: Wire | undefined };
  const setup = (reply: (c: Call) => Response) => {
    const calls: Call[] = [];
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u, init) => {
        const url = new URL(urlOf(u));
        const c = {
          method: String(init?.method),
          url: url.pathname + url.search,
          body: bodyOf(init),
        };
        calls.push(c);
        return reply(c);
      },
    });
    return { calls, f: b.forge };
  };
  const b64 = (s: string) => Buffer.from(s).toString('base64');

  void it(
    'listFiles resolves the commit, requests the recursive tree, keeps blobs ' + 'and reports truncation',
    async () => {
      const { calls, f } = setup((c) =>
        c.url.includes('/commits/')
          ? json({ sha: 'c1', commit: { tree: { sha: 't1' } } })
          : json({
              truncated: true,
              tree: [
                { type: 'blob', path: 'a b/x.md' },
                { type: 'tree', path: 'a b' },
              ],
            }),
      );
      assert.deepEqual(await f.listFiles('o/r', 'feat/x'), { commit: 'c1', paths: ['a b/x.md'], truncated: true });
      assert.deepEqual(
        calls.map((c) => c.url),
        ['/repos/o/r/commits/feat%2Fx', '/repos/o/r/git/trees/t1?recursive=1'],
      );
    },
  );

  void it('getFile encodes each path segment, pins the ref and decodes base64', async () => {
    const { calls, f } = setup(() => json({ encoding: 'base64', content: b64('héllo'), sha: 's1' }));
    assert.deepEqual(await f.getFile('o/r', 'dir x/a#b.md', 'c1'), { content: 'héllo', sha: 's1' });
    assert.equal(calls[0]!.url, '/repos/o/r/contents/dir%20x/a%23b.md?ref=c1');
  });

  void it('getFile falls back to the blob API for files over 1 MB', async () => {
    const { calls, f } = setup((c) =>
      c.url.includes('/git/blobs/')
        ? json({ content: b64('big') })
        : json({ encoding: 'none', content: '', sha: 's2' }),
    );
    assert.equal((await f.getFile('o/r', 'big.md')).content, 'big');
    assert.equal(calls[1]!.url, '/repos/o/r/git/blobs/s2');
  });

  void it('putFile PUTs base64 content with branch and sha', async () => {
    const { calls, f } = setup(() => json({ content: { sha: 'n1' } }));
    assert.deepEqual(
      await f.putFile('o/r', { branch: 'b', path: 'd e/f.md', content: 'héllo', message: 'm', expectSha: 'old' }),
      { sha: 'n1' },
    );
    assert.deepEqual(calls[0], {
      method: 'PUT',
      url: '/repos/o/r/contents/d%20e/f.md',
      body: { message: 'm', content: b64('héllo'), branch: 'b', sha: 'old' },
    });
  });

  void it('putFile maps 409 and 422 to Conflict, other errors pass through', async () => {
    for (const status of [409, 422]) {
      await assert.rejects(
        setup(() => new Response('x', { status })).f.putFile('o/r', {
          branch: 'b',
          path: 'p',
          content: 'c',
          message: 'm',
        }),
        Conflict,
      );
    }
    await assert.rejects(
      setup(() => new Response('x', { status: 500 })).f.putFile('o/r', {
        branch: 'b',
        path: 'p',
        content: 'c',
        message: 'm',
      }),
      /500/,
    );
  });

  void it("expectSha '' pre-checks existence: exists is a Conflict, 404 proceeds, no sha is sent", async () => {
    const exists = setup(() => json({}));
    await assert.rejects(
      exists.f.putFile('o/r', { branch: 'b', path: 'p', content: 'c', message: 'm', expectSha: '' }),
      Conflict,
    );
    assert.deepEqual(
      exists.calls.map((c) => c.method),
      ['GET'],
    );
    assert.equal(exists.calls[0]!.url, '/repos/o/r/contents/p?ref=b');
    const fresh = setup((c) =>
      c.method === 'GET' ? new Response('nf', { status: 404 }) : json({ content: { sha: 'n' } }),
    );
    await fresh.f.putFile('o/r', { branch: 'b', path: 'p', content: 'c', message: 'm', expectSha: '' });
    assert.deepEqual(
      fresh.calls.map((c) => c.method),
      ['GET', 'PUT'],
    );
    assert.equal('sha' in (fresh.calls[1]!.body ?? {}), false);
  });
});
