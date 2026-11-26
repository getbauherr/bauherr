import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeBackend, GithubBackend, patAuth } from '../src/index.js';
import { setup } from './gitlab-setup.js';
import { bodyOf, json, urlOf } from './helpers.js';

const github = (known: unknown[] = []) => {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const b = new GithubBackend({
    auth: patAuth('t'),
    fetch: async (u, init) => {
      const path = new URL(urlOf(u)).pathname;
      const method = init?.method ?? 'GET';
      calls.push({ method, path, body: bodyOf(init) });
      if (method === 'POST' && path.endsWith('/git/refs')) return json({}, { status: 201 });
      if (method === 'POST' && path.endsWith('/dispatches')) return new Response(null, { status: 204 });
      if (path.endsWith('/releases') && method === 'GET') return json(known);
      if (path.includes('/commits/')) return json({ sha: 's1' });
      return json({ id: 7, tag_name: 'v1.0.0', draft: method === 'POST', name: 'v1.0.0', body: 'b', html_url: 'u' });
    },
  });
  return { b, calls };
};

const input = { tag: 'v1.0.0', sha: 's1', name: 'v1.0.0', body: 'b' };

void describe('github release writes', () => {
  void it('creates the tag and a draft release once', async () => {
    const { b, calls } = github();
    const release = await b.forge.draftRelease('o/r', input);
    assert.equal(release.draft, true);
    assert.deepEqual(
      calls.filter((c) => c.method === 'POST').map((c) => [c.path, (c.body as { draft?: boolean }).draft]),
      [
        ['/repos/o/r/git/refs', undefined],
        ['/repos/o/r/releases', true],
      ],
    );
  });
  void it('returns a known release for the tag without writing', async () => {
    const known = [{ id: 7, tag_name: 'v1.0.0', draft: true, name: 'v1.0.0', body: 'b', html_url: 'u' }];
    const { b, calls } = github(known);
    const release = await b.forge.draftRelease('o/r', input);
    assert.equal(release.id, '7');
    assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
  });
  void it('publishes by patching the draft flag and starts the workflow with the version', async () => {
    const { b, calls } = github();
    await b.forge.publishRelease('o/r', '7', { body: 'notes' });
    await b.forge.startDeploy('o/r', {
      workflow: '.github/workflows/production.yml',
      ref: 'v1.0.0',
      inputs: { version: 'v1.0.0' },
    });
    const patch = calls.find((c) => c.method === 'PATCH');
    assert.deepEqual(patch?.body, { draft: false, body: 'notes', make_latest: 'true' });
    const dispatch = calls.find((c) => c.path.endsWith('/dispatches'));
    assert.equal(dispatch?.path, '/repos/o/r/actions/workflows/production.yml/dispatches');
    assert.deepEqual(dispatch?.body, { ref: 'v1.0.0', inputs: { version: 'v1.0.0' } });
  });
});

void describe('github release for a tag that exists on an older commit', () => {
  void it('reports the commit of the existing tag, not the new one', async () => {
    const b = new GithubBackend({
      auth: patAuth('t'),
      fetch: async (u, init) => {
        const path = new URL(urlOf(u)).pathname;
        const method = init?.method ?? 'GET';
        if (method === 'POST' && path.endsWith('/git/refs')) return json({ message: 'exists' }, { status: 422 });
        if (path.endsWith('/releases') && method === 'GET') return json([]);
        if (path.includes('/commits/')) return json({ sha: 'OLD' });
        return json({ id: 7, tag_name: 'v1.0.0', draft: true, name: 'v1.0.0', body: 'b', html_url: 'u' });
      },
    });
    assert.equal((await b.forge.draftRelease('o/r', { ...input, sha: 'NEW' })).sha, 'OLD');
  });
});

void describe('gitlab release writes', () => {
  const release = { tag_name: 'v1.0.0', name: 'v1.0.0', description: 'b', commit: { id: 's1' }, _links: { self: 'u' } };
  void it('creates the tag and an upcoming release, then publishes it', async () => {
    const { b, calls } = setup((method, path) => {
      if (method === 'GET' && path.includes('/releases/')) return new Response('{}', { status: 404 });
      return release;
    });
    const drafted = await b.forge.draftRelease('g/p', input);
    assert.equal(drafted.draft, true);
    await b.forge.publishRelease('g/p', 'v1.0.0', { body: 'notes' });
    const posts = calls.filter((c) => c.method === 'POST').map((c) => c.path);
    assert.deepEqual(posts, ['/projects/g%2Fp/repository/tags', '/projects/g%2Fp/releases']);
    const upcoming = (calls.find((c) => c.path.endsWith('/releases') && c.method === 'POST')?.body ?? {}) as {
      released_at?: string;
    };
    assert.ok(Date.parse(upcoming.released_at ?? '') > Date.now());
    assert.equal(calls.find((c) => c.method === 'PUT')?.body?.description, 'notes');
  });
  void it('reports the commit of a tag that already exists', async () => {
    const old = { ...release, commit: { id: 'OLD' } };
    const { b } = setup((method, path) => {
      if (method === 'GET' && path.includes('/releases/')) return new Response('{}', { status: 404 });
      if (path.endsWith('/repository/tags')) return new Response('{}', { status: 400 });
      return old;
    });
    assert.equal((await b.forge.draftRelease('g/p', { ...input, sha: 'NEW' })).sha, 'OLD');
  });
  void it('starts a pipeline at the tag with the version as a variable', async () => {
    const { b, calls } = setup(() => ({}));
    await b.forge.startDeploy('g/p', { workflow: '.gitlab-ci.yml', ref: 'v1.0.0', inputs: { version: 'v1.0.0' } });
    assert.deepEqual(calls[0]?.body, { ref: 'v1.0.0', variables: [{ key: 'version', value: 'v1.0.0' }] });
  });
});

void describe('fake release writes', () => {
  void it('hides a draft until it is published and counts deploy starts', async () => {
    const fake = new FakeBackend();
    const draft = await fake.forge.draftRelease('o/r', input);
    assert.equal((await fake.forge.draftRelease('o/r', input)).id, draft.id);
    assert.equal(await fake.forge.releaseByTag('o/r', 'v1.0.0'), null);
    assert.deepEqual(await fake.forge.listTags('o/r'), ['v1.0.0']);
    await fake.forge.publishRelease('o/r', draft.id, { body: 'notes' });
    assert.equal((await fake.forge.releaseByTag('o/r', 'v1.0.0'))?.body, 'notes');
    await fake.forge.startDeploy('o/r', { workflow: 'w', ref: 'v1.0.0', inputs: {} });
    assert.equal(fake.deployStarts('o/r').length, 1);
  });
});
