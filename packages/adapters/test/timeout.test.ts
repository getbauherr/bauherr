import assert from 'node:assert/strict';
import { it } from 'node:test';
import { appAuth, GithubBackend, GitlabBackend, gitlabPat, patAuth } from '../src/index.js';

/** A forge that never answers but honours the abort signal. */
const hang: typeof fetch = (_url, init) =>
  new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));

it('github request rejects after the timeout', async () => {
  const b = new GithubBackend({ auth: patAuth('t'), fetch: hang, timeoutMs: 20 });
  await assert.rejects(b.tickets('a/b').get('1'), /api\.github\.com request timed out/);
});

it('github installation token request rejects after the timeout', async () => {
  const auth = appAuth({ appId: 1, installationId: 2, privateKeyPem: (await import('node:crypto')).generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, fetch: hang, timeoutMs: 20 });
  await assert.rejects(auth.token(), /request timed out/);
});

it('gitlab request rejects after the timeout', async () => {
  const b = new GitlabBackend({ auth: gitlabPat('t'), fetch: hang, timeoutMs: 20 });
  await assert.rejects(b.tickets('a/b').get('1'), /gitlab\.com request timed out/);
});
