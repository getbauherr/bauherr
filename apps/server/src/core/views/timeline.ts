import type { AppEvent, EventOf, EventType, Stage } from '../events'
import { STAGE_ENTRY } from './sql'

export type TimelineKind = 'run' | 'owner' | 'factory' | 'criteria' | 'other'
export type TimelineTone = 'neutral' | 'ok' | 'warn' | 'error'
export type TimelineMark = { kind: TimelineKind; tone: TimelineTone; state: string | null }

type Marks = { [T in EventType]: (event: EventOf<T>) => TimelineMark }

const mark = (kind: TimelineKind, state: string | null = null, tone: TimelineTone = 'neutral') => ({
  kind,
  tone,
  state,
})
const fixed =
  (...args: Parameters<typeof mark>) =>
  () =>
    mark(...args)
const run = (state: string, tone: TimelineTone = 'neutral') => fixed('run', state, tone)
const owner = (state: string | null, tone: TimelineTone = 'neutral') => fixed('owner', state, tone)
const factory = (state: string | null, tone: TimelineTone = 'neutral') => fixed('factory', state, tone)
const other = (state: string | null = null, tone: TimelineTone = 'neutral') => fixed('other', state, tone)

const MARKS: Marks = {
  'intake.accepted': factory('Accepted', 'ok'),
  'intake.asked': factory('Asked the reporter'),
  'reporter.replied': other(),
  'reporter.reminded': other(),
  'reporter.silent': other('Silent', 'warn'),
  'intake.closed': factory('Closed'),
  'intake.disputed': factory('Disputed', 'warn'),
  'run.started': run('Queued'),
  'run.failed': run('Failed', 'error'),
  'run.released': run('Released'),
  'run.expired': run('Expired', 'error'),
  'brief.submitted': run('Submitted', 'ok'),
  'brief.approved': (e) => (e.data.by === 'owner' ? mark('owner', 'Approved', 'ok') : mark('factory', 'By rule', 'ok')),
  'brief.changes-requested': owner('Changes asked', 'warn'),
  'brief.discarded': owner('Discarded'),
  'build.submitted': run('Submitted', 'ok'),
  'build.already-done': run('Already done', 'ok'),
  'ticket.done-elsewhere': owner('Closed'),
  'pull.adopted': other(),
  'pull.conflicted': other('Conflict', 'warn'),
  'pull.updated': other(),
  'checks.finished': (e) => mark('run', e.data.passed ? 'Passed' : 'Failed', e.data.passed ? 'ok' : 'error'),
  'review.submitted': (e) => (e.data.findings === 0 ? mark('run', 'Clean', 'ok') : mark('run', 'Findings', 'warn')),
  'verify.passed': run('Passed', 'ok'),
  'verify.changes': run('Changes asked', 'warn'),
  'ship.merged': other('Merged', 'ok'),
  'ship.deployed': other('Deployed', 'ok'),
  'ship.deploy-stalled': other('Stalled', 'error'),
  'result.accepted': (e) =>
    e.data.auto ? mark('factory', 'Accepted by the factory', 'ok') : mark('owner', 'Accepted', 'ok'),
  'result.sent-back': owner('Sent back', 'warn'),
  'production.approved': owner('Approved', 'ok'),
  'production.held': owner('Held', 'warn'),
  'owner.note': owner(null),
  'request.commented': other(),
  'run.comments.delivered': run('Delivered'),
  'ticket.closed': (e) => mark(e.data.reason === 'closed-on-forge' ? 'other' : 'owner', 'Closed'),
  'ticket.restored': owner('Restored'),
  'ticket.blocked': (e) =>
    e.data.reason === null ? mark('factory', 'Unblocked', 'ok') : mark('factory', 'Blocked', 'warn'),
  'criteria.dropped': fixed('criteria', 'Dropped', 'warn'),
  'verify.overridden': owner('Overridden', 'warn'),
  'question.asked': factory('Asked you', 'warn'),
  'question.answered': owner('Answered'),
  'forge.write.started': other(),
  'forge.write.done': other(),
  'forge.write.failed': other('Failed', 'error'),
  'forge.write.deferred': other('Drafted'),
}

const markOf = <T extends EventType>(event: EventOf<T>): TimelineMark => MARKS[event.type](event)

export const timelineOf = (event: AppEvent): TimelineMark & { enters: Stage | null } => ({
  ...markOf(event),
  enters: STAGE_ENTRY[event.type] ?? null,
})
