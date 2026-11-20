import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeBackend, GithubBackend, GitlabBackend, gitlabPat, patAuth } from '../src/index.js';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const missing = () => new Response('no', { status: 404 });
const pathOf = (input: Parameters<typeof fetch>[0]): string => (input instanceof Request ? input.url : String(input));

const github = (handler: (path: string) => Response) =>
  new GithubBackend({ auth: patAuth('t'), fetch: async (u) => handler(new URL(pathOf(u)).pathname) }).forge;
const gitlab = (handler: (path: string) => Response) =>
  new GitlabBackend({
    auth: gitlabPat('t'),
    baseUrl: 'https://gitlab.test',
    sleep: async () => {},
    fetch: async (u) => handler(decodeURIComponent(pathOf(u).slice('https://gitlab.test/api/v4'.length))),
  }).forge;

void describe('github repository facts', () => {
  void it('reads whether a branch is protected', async () => {
    const forge = (value: boolean) =>
      github((path) => (path === '/repos/o/r/branches/main' ? json({ protected: value }) : missing()));
    assert.equal(await forge(true).isBranchProtected('o/r', 'main'), true);
    assert.equal(await forge(false).isBranchProtected('o/r', 'main'), false);
  });
  void it('tells an existing file from a missing one', async () => {
    const forge = github((path) => (path === '/repos/o/r/contents/AGENTS.md' ? json({ type: 'file' }) : missing()));
    assert.equal(await forge.fileExists('o/r', 'AGENTS.md', 'main'), true);
    assert.equal(await forge.fileExists('o/r', 'CLAUDE.md', 'main'), false);
  });
  void it('counts yml and yaml issue forms and skips the chooser config and other files', async () => {
    const names = ['bug.yml', 'idea.yaml', 'config.yml', 'old.md'];
    const entries = [...names.map((name) => ({ type: 'file', name })), { type: 'dir', name: 'x.yml' }];
    const forge = github((path) => (path === '/repos/o/r/contents/.github/ISSUE_TEMPLATE' ? json(entries) : missing()));
    assert.equal(await forge.countIssueForms('o/r', 'main'), 2);
    assert.equal(await github(missing).countIssueForms('o/r', 'main'), 0);
  });
});

void describe('gitlab repository facts', () => {
  void it('reads protection: yes, no, and unknown when the token may not read it', async () => {
    const answer = (status: number) =>
      gitlab(() => (status === 200 ? json({ name: 'main' }) : new Response('x', { status })));
    assert.equal(await answer(200).isBranchProtected('g/p', 'main'), true);
    assert.equal(await answer(404).isBranchProtected('g/p', 'main'), false);
    assert.equal(await answer(403).isBranchProtected('g/p', 'main'), null);
    await assert.rejects(answer(500).isBranchProtected('g/p', 'main'));
  });
  void it('tells an existing file from a missing one', async () => {
    const forge = gitlab((path) => (path.includes('/repository/files/AGENTS.md?ref=main') ? json({}) : missing()));
    assert.equal(await forge.fileExists('g/p', 'AGENTS.md', 'main'), true);
    assert.equal(await forge.fileExists('g/p', 'CLAUDE.md', 'main'), false);
  });
  void it('counts description templates as issue forms', async () => {
    const entries = [
      { type: 'blob', name: 'bug.md' },
      { type: 'blob', name: 'x.yml' },
      { type: 'tree', name: 's.md' },
    ];
    const forge = gitlab((path) => (path.includes('path=.gitlab/issue_templates') ? json(entries) : missing()));
    assert.equal(await forge.countIssueForms('g/p', 'main'), 1);
    assert.equal(await gitlab(missing).countIssueForms('g/p', 'main'), 0);
  });
  void it('still answers nothing for required checks', async () => {
    assert.deepEqual(await gitlab(missing).requiredChecks('g/p', 'main'), []);
  });
});

void describe('fake repository facts', () => {
  void it('answers from the default branch files, the protection flag and the required checks', async () => {
    const fake = new FakeBackend();
    const { forge } = fake;
    assert.equal(await forge.isBranchProtected('o/r', 'main'), false);
    fake.setBranchProtected('o/r', true);
    assert.equal(await forge.isBranchProtected('o/r', 'main'), true);
    fake.setBranchProtected('o/r', null);
    assert.equal(await forge.isBranchProtected('o/r', 'main'), null);
    for (const path of ['AGENTS.md', '.github/ISSUE_TEMPLATE/bug.yml', '.github/ISSUE_TEMPLATE/config.yml']) {
      fake.commit('o/r', 'main', path, 'x');
    }
    fake.commit('o/r', 'main', '.gitlab/issue_templates/idea.md', 'x');
    assert.equal(await forge.fileExists('o/r', 'AGENTS.md', 'main'), true);
    assert.equal(await forge.fileExists('o/r', 'CLAUDE.md', 'main'), false);
    assert.equal(await forge.countIssueForms('o/r', 'main'), 2);
  });
});
