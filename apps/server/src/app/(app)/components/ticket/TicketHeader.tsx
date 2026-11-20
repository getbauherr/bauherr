import Link from 'next/link'
import { STAGES, type Stage } from '../../../../core/events'
import type { TicketView } from '../../../../core/views/ticket'
import { STAGE_NAMES } from '../../lib/factory'
import { StatusChip } from '../StatusChip'

const STEP = ['text-ok', 'font-medium text-foreground', undefined]

const PATH: Stage[] = STAGES.filter((stage) => stage !== 'done')

function StagePath({ stage }: { stage: Stage }) {
  const at = stage === 'done' ? PATH.length : PATH.indexOf(stage)
  return (
    <nav aria-label="Stage path">
      <ol className="small m-0 flex list-none flex-wrap items-center gap-2 p-0 text-muted-foreground">
        {PATH.map((entry, index) => (
          <li key={entry} aria-current={index === at ? 'step' : undefined} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden>›</span>}
            <span className={STEP[Math.sign(index - at) + 1]}>
              {index < at ? `✓ ${STAGE_NAMES[entry]}` : STAGE_NAMES[entry]}
              {index < at && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function TicketHeader({ view }: { view: TicketView }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="text-primary hover:underline">Factory</Link>
        <span className="mono">#{view.number}</span>
        <h1 className="title">{view.title}</h1>
        <StatusChip status={view.status} closedAs={view.closedAs} />
      </div>
      <StagePath stage={view.stage} />
    </>
  )
}
