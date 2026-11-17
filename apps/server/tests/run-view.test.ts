import { expect, it } from 'vitest'
import { exactTime, runLinks, runTimes, timelineEmpty } from '../src/app/(app)/lib/run-view'

const ticket = { id: 7, number: 214 }
const now = Date.parse('2026-11-16T10:10:00Z')

it('labels the merge request from the forge and drops it without a web url', () => {
  const rows = runLinks({ forge: 'gitlab', prUrl: 'https://gitlab.example/acme/web/-/merge_requests/88', ciUrl: 'https://gitlab.example/acme/web/-/pipelines/1', issueUrl: 'https://gitlab.example/acme/web/-/issues/214', ticket })
  expect(rows.map((r) => r.label)).toEqual(['Merge request !88 on GitLab', 'CI checks on GitLab', 'Issue #214 on GitLab', 'Ticket #214'])
  expect(rows.map((r) => r.external)).toEqual([true, true, true, false])
  expect(runLinks({ forge: 'github', prUrl: 'https://github.com/a/b/pull/88', ticket })[0]!.label).toBe('Pull request #88 on GitHub')
  expect(runLinks({ forge: 'github', prUrl: 'javascript:alert(1)', ciUrl: 'nope', issueUrl: null, ticket }).map((r) => r.label)).toEqual(['Ticket #214'])
})

it('says what an empty Timeline means for each kind of state, never "No steps recorded."', () => {
  const started = '2026-11-16T10:07:00Z'
  expect(timelineEmpty('working', started, now)).toBe('The agent has not reported a step yet. It started 3 min ago. Steps appear here when it reports them.')
  expect(timelineEmpty('stuck', null, now)).toBe('The agent has not reported a step yet. Steps appear here when it reports them.')
  expect(timelineEmpty('awaiting_session', null, now)).toBe('Nothing yet. The agent has not started this Run.')
  expect(timelineEmpty('succeeded', started, now)).toBe('This Run recorded no steps.')
})

it('lists the Times that exist, in order, with the exact time in UTC', () => {
  expect(runTimes({ createdAt: '2026-11-16T09:00:00Z', startedAt: null, finishedAt: '2026-11-16T09:30:00Z' }, '2026-11-16T09:20:00Z').map((t) => t.label)).toEqual(['Queued', 'Last report', 'Ended'])
  expect(exactTime('2026-11-16T09:10:05.000Z')).toBe('2026-11-16 09:10 UTC')
})
