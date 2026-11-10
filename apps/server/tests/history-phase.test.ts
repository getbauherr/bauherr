import { expect, it } from 'vitest'
import { phaseOf } from '../src/lib/history'
import { DEFAULT } from '../src/lib/workflow'

const run = (status: string, extra: Record<string, unknown> = {}) => ({ stage: 'build', kind: 'build', status, ...extra })

it.each([
  ['a closed Ticket', { state: 'closed', stage: 'done' }, run('succeeded'), 'closed'],
  ['a Ticket in the done stage', { stage: 'done' }, null, 'closed'],
  ['a closed Ticket beats a live Run', { state: 'closed', stage: 'build' }, run('running'), 'closed'],
  ['a running Run', { stage: 'build' }, run('running'), 'working'],
  ['a running Run beats a need', { stage: 'review', reviewState: 'needs_human' }, run('running', { stage: 'review', kind: 'review' }), 'working'],
  ['a Run of an earlier stage is not the work', { stage: 'review' }, run('running'), 'queued'],
  ['a queued Run', { stage: 'build' }, run('queued'), 'queued'],
  ['a Run awaiting a session', { stage: 'build' }, run('awaiting_session'), 'queued'],
  ['a Run that needs a human', { stage: 'build' }, run('needs_human', { reasonKind: 'decision' }), 'human'],
  ['a review that needs a human', { stage: 'review', reviewState: 'needs_human' }, run('succeeded', { stage: 'review', kind: 'review' }), 'human'],
  ['production waiting for approval', { stage: 'release', releaseState: 'on_staging', productionState: 'awaiting_approval' }, null, 'human'],
  ['a need beats waiting on CI', { stage: 'review', reviewState: 'needs_human', waitingFor: 'checks' }, null, 'human'],
  ['waiting for checks', { stage: 'build', waitingFor: 'checks' }, null, 'ci'],
  ['review waiting for checks', { stage: 'review', reviewState: 'waiting_checks' }, null, 'ci'],
  ['review in the merge queue', { stage: 'review', reviewState: 'queued' }, null, 'ci'],
  ['release waiting for staging checks', { stage: 'release', releaseState: 'waiting' }, null, 'ci'],
  ['a production deploy', { stage: 'release', productionState: 'deploying' }, null, 'ci'],
  ['release checks waiting', { stage: 'build', releaseChecksState: 'waiting' }, null, 'ci'],
  ['a stale review state outside review', { stage: 'build', reviewState: 'waiting_checks' }, null, 'queued'],
  ['a stale release state outside release', { stage: 'build', releaseState: 'waiting', productionState: 'deploying' }, null, 'queued'],
  ['a Ticket with no stage and no Run', { stage: null }, null, 'queued'],
  ['a Ticket waiting for a full column', { stage: 'plan', waitingFor: 'build' }, null, 'queued'],
  ['a system Run is not the Ticket\'s work', { stage: 'build' }, { stage: 'scan', kind: 'scan', status: 'running' }, 'queued'],
])('phaseOf: %s', (_name, ticket, latest, phase) => {
  expect(phaseOf(DEFAULT(), { state: 'open', labels: [], ...ticket }, latest)).toBe(phase)
})
