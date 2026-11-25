import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GithubBackend, patAuth } from '../src/index.js';
import { probeCommit } from '../src/release-probe.js';
import { json, urlOf } from './helpers.js';
import { setup } from './gitlab-setup.js';

const github = (answer: (path: string) => unknown) =>
  new GithubBackend({ auth: patAuth('t'), fetch: async (u) => json(answer(new URL(urlOf(u)).pathname)) }).forge;

void describe('github release reads', () => {
  void it('reads the latest deployment of an environment with the address of its newest status', async () => {
    const forge = github((path) =>
      path.endsWith('/statuses')
        ? [{ environment_url: 'https://staging.example.com', state: 'success' }]
        : [{ id: 7, sha: 'abc' }],
    );
    const url = 'https://staging.example.com';
    assert.deepEqual(await forge.latestDeployment('o/r', 'staging'), { sha: 'abc', url, state: 'success' });
  });

  void it('has no deployment, and no address without a status', async () => {
    assert.equal(await github(() => []).latestDeployment('o/r', 'staging'), null);
    const forge = github((path) => (path.endsWith('/statuses') ? [] : [{ id: 7, sha: 'abc' }]));
    assert.deepEqual(await forge.latestDeployment('o/r', 'staging'), { sha: 'abc', url: null, state: 'pending' });
  });

  void it('may write when the token has push rights', async () => {
    assert.equal(await github(() => ({ permissions: { push: true } })).canWrite('o/r'), true);
    assert.equal(await github(() => ({ permissions: { push: false } })).canWrite('o/r'), false);
  });
});

void describe('gitlab release reads', () => {
  void it('reads the latest deployment with the external address of its environment', async () => {
    const environment = { external_url: 'https://s.example.com' };
    const deployment = { deployable: { commit: { id: 'abc' } }, environment, status: 'failed' };
    const { forge } = setup(() => [deployment]);
    const url = 'https://s.example.com';
    assert.deepEqual(await forge.latestDeployment('g/p', 'staging'), { sha: 'abc', url, state: 'failure' });
  });

  void it('may write from developer access on the project or its group', async () => {
    const level = (project: number, group: number) => {
      const permissions = { project_access: { access_level: project }, group_access: { access_level: group } };
      return setup(() => ({ permissions })).forge;
    };
    assert.equal(await level(0, 30).canWrite('g/p'), true);
    assert.equal(await level(20, 0).canWrite('g/p'), false);
  });
});

void describe('probeCommit', () => {
  const answering = (body: string) => async () => new Response(body);
  const o = { url: 'https://staging.example.com', sha: 'abcdef1234567' };

  void it('finds the short commit in the answer of a usual version path', async () => {
    assert.equal(await probeCommit(answering('{"commit":"abcdef1"}') as typeof fetch, o), true);
    assert.equal(await probeCommit(answering('{"commit":"other"}') as typeof fetch, o), false);
  });

  void it('does not call addresses that are not public https', async () => {
    let calls = 0;
    const counting = (async () => (calls++, new Response('abcdef1'))) as typeof fetch;
    for (const url of ['http://staging.example.com', 'https://localhost', 'https://10.0.0.1', 'https://intranet']) {
      assert.equal(await probeCommit(counting, { ...o, url }), false);
    }
    assert.equal(calls, 0);
  });
});
