import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GithubBackend, patAuth } from '../src/index.js';
import { json, urlOf } from './helpers.js';

void describe('github isAncestor', () => {
  const compare = async (status: string) => {
    const paths: string[] = [];
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u) => (paths.push(new URL(urlOf(u)).pathname), json({ status })),
    });
    return { result: await b.forge.isAncestor('o/r', 'base1', 'head1'), paths };
  };
  void it('is true when head is ahead of or identical to base', async () => {
    assert.equal((await compare('ahead')).result, true);
    assert.equal((await compare('identical')).result, true);
  });
  void it('is false when head is behind or diverged from base', async () => {
    assert.equal((await compare('behind')).result, false);
    assert.equal((await compare('diverged')).result, false);
  });
  void it('compares base...head', async () => {
    assert.deepEqual((await compare('ahead')).paths, ['/repos/o/r/compare/base1...head1']);
  });
});

void describe('github listReleases', () => {
  void it('drops drafts and releases whose tag returns 404', async () => {
    const paths: string[] = [];
    const releases = [
      {
        id: 1,
        tag_name: 'v1',
        draft: false,
        name: 'v1',
        body: '',
        html_url: 'u1',
        prerelease: false,
        created_at: 'c1',
      },
      { id: 2, tag_name: 'v2', draft: true, name: 'v2', body: '', html_url: 'u2', prerelease: false, created_at: 'c2' },
      {
        id: 3,
        tag_name: 'v3',
        draft: false,
        name: 'v3',
        body: '',
        html_url: 'u3',
        prerelease: false,
        created_at: 'c3',
      },
    ];
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u) => {
        const path = new URL(urlOf(u)).pathname;
        paths.push(path);
        if (path === '/repos/o/r/releases') return json(releases);
        if (path === '/repos/o/r/commits/v1') return json({ sha: 'a1' });
        return new Response('gone', { status: 404 });
      },
    });
    const listed = await b.forge.listReleases('o/r');
    assert.deepEqual(
      listed.map((r) => [r.tag, r.sha]),
      [['v1', 'a1']],
    );
    assert.ok(!paths.includes('/repos/o/r/commits/v2'));
  });
});

void describe('github releaseByTag', () => {
  void it('one request for the tag and one for its commit; a 404 or a draft gives null', async () => {
    const paths: string[] = [];
    const release = {
      id: 1,
      tag_name: 'v1',
      draft: false,
      name: 'v1',
      body: '',
      html_url: 'u1',
      prerelease: false,
      created_at: 'c1',
    };
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u) => {
        const path = new URL(urlOf(u)).pathname;
        paths.push(path);
        if (path === '/repos/o/r/releases/tags/v1') return json(release);
        if (path === '/repos/o/r/releases/tags/v2') return json({ ...release, tag_name: 'v2', draft: true });
        if (path === '/repos/o/r/commits/v1') return json({ sha: 'a1' });
        return new Response('gone', { status: 404 });
      },
    });
    assert.equal((await b.forge.releaseByTag('o/r', 'v1'))?.sha, 'a1');
    assert.deepEqual(paths, ['/repos/o/r/releases/tags/v1', '/repos/o/r/commits/v1']);
    paths.length = 0;
    assert.equal(await b.forge.releaseByTag('o/r', 'v9'), null);
    assert.equal(await b.forge.releaseByTag('o/r', 'v2'), null);
    assert.deepEqual(paths, ['/repos/o/r/releases/tags/v9', '/repos/o/r/releases/tags/v2']);
  });
});
