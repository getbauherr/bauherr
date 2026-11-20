import type { AppEvent, EventOf, EventType } from '../events'

type Labels = { [T in EventType]: (event: EventOf<T>) => string }

const WRITES: Record<EventOf<'forge.write.done'>['data']['kind'], string> = {
  'stage-label': 'the stage label',
  'status-comment': 'the status comment',
  question: 'a question comment',
  merge: 'the merge',
  close: 'closing the issue',
}

const LABELS: Labels = {
  'intake.accepted': () => 'The issue was accepted and goes to a Brief',
  'intake.asked': (e) => `The reporter was asked questions (round ${e.data.round})`,
  'reporter.replied': () => 'The reporter replied',
  'reporter.reminded': () => 'The reporter was reminded of the open questions',
  'reporter.silent': () => 'The reporter did not answer in time',
  'intake.closed': (e) => `The issue was closed as ${e.data.reason.replace(/-/g, ' ')}`,
  'intake.disputed': () => 'The agent disputes that this is a change to make',
  'run.started': (e) => `A ${e.data.stage} run was queued`,
  'run.failed': (e) => `A ${e.data.stage} run failed: ${e.data.reason}`,
  'run.released': (e) => `A ${e.data.stage} run was released`,
  'brief.submitted': () => 'A Brief was submitted',
  'brief.approved': (e) => (e.data.by === 'owner' ? 'The owner approved the Brief' : 'The Brief was approved by rule'),
  'brief.changes-requested': (e) => `The owner asked for changes to the Brief: ${e.data.note}`,
  'brief.discarded': () => 'The Brief was discarded and the ticket closed',
  'build.submitted': (e) => `A patch was submitted as pull request #${e.data.pr}`,
  'checks.finished': (e) => (e.data.passed ? 'The checks passed' : 'The checks failed'),
  'verify.passed': () => 'Verification passed',
  'verify.changes': () => 'Verification asked for changes',
  'ship.merged': (e) => `The pull request was merged (${e.data.sha.slice(0, 7)})`,
  'ship.deployed': () => 'The change was deployed',
  'result.accepted': () => 'The owner accepted the Result',
  'result.sent-back': (e) => `The owner sent the Result back: ${e.data.note}`,
  'production.approved': () => 'The owner approved production',
  'production.held': () => 'The owner holds production',
  'owner.note': (e) => `The owner left a note: ${e.data.note}`,
  'ticket.closed': (e) =>
    e.data.reason === 'discarded' ? 'The owner discarded the ticket' : 'The issue was closed on the forge',
  'verify.overridden': () => 'The owner accepted the patch without a passing verification',
  'question.asked': (e) => `The factory asked the owner a question (${e.data.reason.replace(/-/g, ' ')})`,
  'question.answered': (e) => `The owner answered: ${e.data.option.replace(/-/g, ' ')}`,
  'forge.write.started': (e) => `Writing ${WRITES[e.data.kind]} to the forge`,
  'forge.write.done': (e) => `Wrote ${WRITES[e.data.kind]} to the forge`,
  'forge.write.failed': (e) => `Writing ${WRITES[e.data.kind]} to the forge failed: ${e.data.reason}`,
}

const label = <T extends EventType>(event: EventOf<T>): string => LABELS[event.type](event)

export const labelOf = (event: AppEvent): string => label(event)
