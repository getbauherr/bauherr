import type { RunView } from '../../../../core/views/ticket-parts'
import type { TicketView } from '../../../../core/views/ticket'
import { CLOSED_WORDS } from '../../lib/status-words'
import { ROLE_WORDS } from '../../lib/ticket'
import { RunLink } from './RunLink'
import { Card, Facts } from './Section'

const WAITING: Partial<Record<TicketView['status'], string>> = {
  'waiting-for-checks': 'Waiting for CI. The factory goes on when the checks finish.',
  'waiting-for-deploy': 'Waiting for the deploy. The factory goes on when it is done.',
  'reporter-asked': 'Waiting for the reporter. Nothing to do.',
}

const liveRun = (view: TicketView): RunView | undefined =>
  view.runs.findLast((run) => run.status === 'queued' || run.status === 'claimed')

const sentenceOf = (view: TicketView, run: RunView | undefined): string => {
  if (view.ended === 'accepted') return 'The Result was accepted. Nothing to do.'
  if (view.ended === 'closed') return `Closed${view.closedAs ? `: ${CLOSED_WORDS[view.closedAs]}` : ''}. Nothing to do.`
  if (view.parked !== null) return `Parked: ${view.parked}. Nothing to do.`
  if (run) {
    const role = ROLE_WORDS[run.role] ?? run.role
    return run.status === 'claimed' ? `The ${role} is working on it.` : `Queued for a ${role}. Nothing to do.`
  }
  return WAITING[view.status] ?? 'The factory has the turn. Nothing to do.'
}

export function StatusBlock({ view }: { view: TicketView }) {
  const run = liveRun(view)
  const step = run?.steps.at(-1)
  return (
    <Card>
      <p role="status">{sentenceOf(view, run)}</p>
      {run && (
        <Facts
          rows={[
            ['Run', <RunLink key="run" id={run.id} />],
            ['Latest step', step ? step.text : 'The agent has not reported a step yet.'],
          ]}
        />
      )}
    </Card>
  )
}
