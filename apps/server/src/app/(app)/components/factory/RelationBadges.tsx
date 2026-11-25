import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { CardRelations, RelatedTicket } from '../../../../core/views/relations'
import { GitBranch, Lock, TriangleAlert } from '../icons'

const BADGE = cn(
  'label inline-flex w-full items-center gap-1 rounded-sm border bg-card px-2 py-1 text-left outline-none',
  'focus-visible:ring-2 focus-visible:ring-ring',
)
const POPOVER = cn(
  'invisible absolute top-full left-0 z-30 mt-1 w-64 rounded-md border border-border bg-card p-3 opacity-0',
  'shadow-md group-hover/rel:visible group-hover/rel:opacity-100',
  'group-focus-within/rel:visible group-focus-within/rel:opacity-100',
)

type Props = { recordId: number; relations: CardRelations }

function Popover({ id, title, tickets }: { id: string; title: string; tickets: RelatedTicket[] }) {
  return (
    <div id={id} role="tooltip" className={POPOVER}>
      <p className="label">{title}</p>
      <ul className="m-0 grid list-none gap-1 p-0 pt-1.5">
        {tickets.map((ticket) => (
          <li key={ticket.number} className="small flex justify-between gap-2">
            <span>
              <span className="mono">#{ticket.number}</span> {ticket.title}
            </span>
            <span className="shrink-0 text-muted-foreground">{ticket.stage}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

type Badge = { key: string; tone: string; icon: ReactNode; text: string; title: string; tickets: RelatedTicket[] }

const RED = 'border-destructive text-destructive'
const QUIET = 'border-border text-muted-foreground'

const badgesOf = ({ blocks, blockedBy, parts }: CardRelations): Badge[] => {
  const found: Badge[] = []
  if (blocks.length) {
    const text = `Blocks ${blocks.length}`
    const icon = <TriangleAlert className="size-3" />
    found.push({ key: 'blocks', tone: RED, icon, text, title: 'Waiting for this ticket', tickets: blocks })
  }
  if (blockedBy.length) {
    const text = `Blocked by ${blockedBy.length}`
    const icon = <Lock className="size-3" />
    found.push({ key: 'blocked-by', tone: QUIET, icon, text, title: 'This ticket waits for', tickets: blockedBy })
  }
  if (parts) {
    const text = `${parts.done}/${parts.total} parts`
    const icon = <GitBranch className="size-3" />
    found.push({ key: 'parts', tone: QUIET, icon, text, title: 'Parts of this ticket', tickets: parts.tickets })
  }
  return found
}

export function RelationBadges({ recordId, relations }: Props) {
  return (
    <div className="relative z-10 grid w-full gap-1">
      {badgesOf(relations).map((badge) => {
        const id = `rel-${recordId}-${badge.key}`
        return (
          <div key={badge.key} className="group/rel relative">
            <button type="button" aria-describedby={id} className={cn(BADGE, badge.tone)}>
              {badge.icon}
              {badge.text}
            </button>
            <Popover id={id} title={badge.title} tickets={badge.tickets} />
          </div>
        )
      })}
    </div>
  )
}
