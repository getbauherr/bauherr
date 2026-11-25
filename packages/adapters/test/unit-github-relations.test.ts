import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GithubBackend, patAuth } from '../src/index.js';
import { bodyOf, json, urlOf } from './helpers.js';

void describe('github relation removal', () => {
  const calls: string[] = [];
  const backend = new GithubBackend({
    auth: patAuth('t'),
    fetch: async (u, init) => {
      const path = new URL(urlOf(u)).pathname;
      calls.push(`${init?.method ?? 'GET'} ${path} ${JSON.stringify(bodyOf(init) ?? null)}`);
      return json({ id: 777, number: 5 });
    },
  });
  void it('removes a sub-issue and a blocked-by link with the global issue id', async () => {
    const tickets = backend.tickets('o/r');
    await tickets.removeSubTicket('1', '5');
    await tickets.removeBlockedBy('2', '5');
    assert.deepEqual(calls, [
      'GET /repos/o/r/issues/5 null',
      'DELETE /repos/o/r/issues/1/sub_issue {"sub_issue_id":777}',
      'GET /repos/o/r/issues/5 null',
      'DELETE /repos/o/r/issues/2/dependencies/blocked_by/777 null',
    ]);
  });

  void it('ignores a blocker or parent from another repository', async () => {
    const issue = (parent: string) => ({
      id: 1,
      number: 1,
      title: 't',
      state: 'open',
      body: '',
      labels: [],
      user: { login: 'u' },
      parent_issue_url: `https://api.github.com/repos/${parent}/issues/7`,
    });
    const blockers = [
      { number: 5, repository_url: 'https://api.github.com/repos/acme/other' },
      { number: 6, repository_url: 'https://api.github.com/repos/o/r' },
    ];
    const fake = (parent: string) =>
      new GithubBackend({
        auth: patAuth('t'),
        fetch: async (u) => json(urlOf(u).includes('blocked_by') ? blockers : issue(parent)),
      }).tickets('o/r');
    const foreign = await fake('acme/other').get('1');
    assert.equal(foreign.parent, null);
    assert.deepEqual(foreign.blockedBy, ['6']);
    assert.equal((await fake('o/r').get('1')).parent, '7');
  });
});
