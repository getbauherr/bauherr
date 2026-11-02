import assert from 'node:assert/strict';
import { it } from 'node:test';
import { GitlabBackend, gitlabPat } from '../src/index.js';
import { contractSuite } from './contract.js';

const { GITLAB_TOKEN: token, GITLAB_BASE_URL: baseUrl, GITLAB_SANDBOX: sandbox } = process.env;

if (!token || !baseUrl || !sandbox) {
  it.skip('gitlab sandbox: set GITLAB_TOKEN, GITLAB_BASE_URL and GITLAB_SANDBOX (group/project)', () => {});
} else {
  const api = (method: string, path: string, body?: unknown) =>
    fetch(`${baseUrl}/api/v4/projects/${encodeURIComponent(sandbox)}${path}`, {
      method,
      headers: { 'private-token': token, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const user: string = ((await (await fetch(`${baseUrl}/api/v4/user`, { headers: { 'private-token': token } })).json()) as { username: string }).username;

  contractSuite('gitlab sandbox', {
    backend: new GitlabBackend({ auth: gitlabPat(token), baseUrl }), repo: sandbox, user,
    async commitFile(branch, path, content) {
      const res = await api('POST', `/repository/files/${encodeURIComponent(path)}`, { branch, content, commit_message: 'contract: add file' });
      assert.equal(res.status, 201);
    },
    async cleanup({ tickets, branches, prs, labels }) {
      for (const n of prs) await api('PUT', `/merge_requests/${n}`, { state_event: 'close' });
      for (const n of tickets) await api('PUT', `/issues/${n}`, { state_event: 'close' });
      for (const b of branches) await api('DELETE', `/repository/branches/${encodeURIComponent(b)}`);
      for (const l of [...labels, 'bauherr:test', 'bauherr:a', 'bauherr:b', 'keep', 'bauherr:approved:plan', 'bauherr:stage:plan', 'bauherr:stage:build']) {
        await api('DELETE', `/labels/${encodeURIComponent(l)}`);
      }
    },
  });
}
