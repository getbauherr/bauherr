import Link from 'next/link'
import type { RunPage } from '../../../../core/views/run'
import type { HealthWord } from '../../../../core/views/run-health'
import { STAGE_NAMES, workerOf } from '../../lib/factory'
import type { StatusWord } from '../../lib/status-words'
import { ROLE_WORDS } from '../../lib/ticket'
import { Time } from '../Time'
import { TicketRef } from '../TicketRef'
import { Button } from '../ui/button'
import { WordBadge } from '../WordBadge'

const WORDS: Record<HealthWord, StatusWord> = {
  Working: { word: 'Working', tone: 'accent' },
  'Waiting for a session': { word: 'Waiting for a session', tone: 'warn', mark: 'clock' },
  Stuck: { word: 'Stuck', tone: 'destructive' },
  Failed: { word: 'Failed', tone: 'destructive', mark: 'cross' },
  Finished: { word: 'Finished', tone: 'ok', mark: 'check' },
}

const ACTIONS = { connect: 'Connect an agent', ticket: 'Open ticket' } as const

export function RunHeader({ run }: { run: RunPage }) {
  const { ticket, health } = run
  const href = health.action === 'connect' ? '/settings/api-key' : `/tickets/${ticket.recordId}`
  return (
    <header className="grid gap-3 rounded-md border border-border bg-card p-6">
      <p className="m-0 [overflow-wrap:anywhere]">
        <TicketRef recordId={ticket.recordId} number={ticket.number} /> {ticket.title}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="title mono">Run {run.id}</h1>
        <WordBadge word={WORDS[health.word]} />
        <p className="small m-0 text-muted-foreground">
          {STAGE_NAMES[run.stage]} · {ROLE_WORDS[run.role] ?? run.role}
          {run.leasedBy !== null && ` · ${workerOf(run.leasedBy).name}`} · started <Time iso={run.startedAt} />
        </p>
      </div>
      <p role="status" className="m-0">{health.sentence}</p>
      {health.action && (
        <div>
          <Button asChild>
            <Link href={href}>{ACTIONS[health.action]}</Link>
          </Button>
        </div>
      )}
    </header>
  )
}
