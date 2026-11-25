import Link from 'next/link'
import { STAGES, type Stage } from '../../../../core/events'
import type { TicketRelations } from '../../../../core/views/ticket-relations'
import type { TicketView } from '../../../../core/views/ticket'
import { STAGE_NAMES } from '../../lib/factory'
import { adoptedLine } from '../../lib/ticket'
import { BlockedChip } from './BlockedChip'
import { StatusChip } from '../StatusChip'
import { TicketRef } from '../TicketRef'

const STEP = ['text-ok', 'font-medium text-foreground', undefined]

const PATH: Stage[] = STAGES.filter((stage) => stage !== 'done')

const ADOPTED_PATH: Stage[] = PATH.filter((stage) => stage !== 'intake' && stage !== 'build')

function StagePath({ stage, steps }: { stage: Stage; steps: Stage[] }) {
  const at = stage === 'done' ? steps.length : steps.indexOf(stage)
  return (
    <nav aria-label="Stage path">
      <ol className="small m-0 flex list-none flex-wrap items-center gap-2 p-0 text-muted-foreground">
        {steps.map((entry, index) => (
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

export function TicketHeader({ view, relations }: { view: TicketView; relations: TicketRelations | null }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="text-primary hover:underline">Factory</Link>
        <TicketRef recordId={view.recordId} number={view.number} />
        <h1 className="title">{view.title}</h1>
        <StatusChip status={view.status} closedAs={view.closedAs} />
        {relations && <BlockedChip blockers={relations.groups['blocked-by']} />}
        {view.adopted && <span className="small text-muted-foreground">{adoptedLine(view.adopted)}</span>}
      </div>
      <StagePath stage={view.stage} steps={view.adopted ? ADOPTED_PATH : PATH} />
    </>
  )
}
