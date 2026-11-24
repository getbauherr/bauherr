import type { RunView } from '../../../../core/views/ticket-parts'
import type { TicketView } from '../../../../core/views/ticket'
import { BACK_ACTION } from '../../lib/decision-actions'
import { CLOSED_WORDS } from '../../lib/status-words'
import { ROLE_WORDS, pullLabel } from '../../lib/ticket'
import { ChecksPanel } from './ChecksPanel'
import { DecisionForm } from './DecisionForm'
import { RunLink } from './RunLink'
import { Card, Facts } from './Section'

const WAITING: Partial<Record<TicketView['status'], string>> = {
  'waiting-for-checks': 'Waiting for CI. The factory goes on when the checks finish.',
  'waiting-for-deploy': 'Waiting for the deploy. The factory goes on when it is done.',
  'reporter-asked': 'Waiting for the reporter. Nothing to do.',
  'waiting-on-author': 'Waiting on the author of the pull request. The factory goes on when a new commit arrives.',
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

const ENDED_WORDS: Record<string, string> = { failed: 'Failed run', expired: 'Expired run' }

const endedRun = (view: TicketView): RunView | undefined => {
  const last = view.runs.at(-1)
  return last && (last.status === 'failed' || last.status === 'expired') ? last : undefined
}

function Checks({ view }: { view: TicketView }) {
  const { pullRequest: pull, verifySince } = view
  if (view.status !== 'waiting-for-checks' || verifySince === null) return null
  const label = pull && `Open ${pullLabel(view.record.source.forge, pull.number)}`
  return (
    <ChecksPanel
      checks={pull?.checks ?? []}
      since={verifySince}
      now={Date.now()}
      pull={pull && pull.url !== '' && label ? { url: pull.url, label } : null}
    />
  )
}

function StatusBody({ view }: { view: TicketView }) {
  const run = liveRun(view)
  const step = run?.steps.at(-1)
  const ended = run ? undefined : endedRun(view)
  return (
    <>
      <p role="status">{sentenceOf(view, run)}</p>
      {ended && <Facts rows={[['Last run', <RunLink key="run" id={ended.id} word={ENDED_WORDS[ended.status]} />]]} />}
      <Checks view={view} />
      {run && (
        <Facts
          rows={[
            ['Run', <RunLink key="run" id={run.id} />],
            ['Latest step', step ? step.text : 'The agent has not reported a step yet.'],
          ]}
        />
      )}
    </>
  )
}

export function StatusBlock({ view }: { view: TicketView }) {
  return (
    <Card>
      <StatusBody view={view} />
    </Card>
  )
}

export function WorkingCard({ view }: { view: TicketView }) {
  return (
    <Card bare>
      <DecisionForm
        recordId={view.recordId}
        ask="working"
        seq={0}
        sentence="Send the ticket back to Brief when the Brief is wrong. The pull request stays open."
        actions={[BACK_ACTION]}
      >
        <div className="grid gap-5 p-6">
          <StatusBody view={view} />
        </div>
      </DecisionForm>
    </Card>
  )
}
