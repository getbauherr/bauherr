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
});
