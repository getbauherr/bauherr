import { Bot, CircleMinus, Dot, Play, User, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EventView, TicketView } from '../../../../core/views/ticket'
import { STAGE_NAMES } from '../../lib/factory'
import { Badge } from '../ui/badge'
import { Time } from '../Time'
import { RefText } from '../RefText'
import { fileUrl } from '../conversation/conversation-api'
import { Card } from './Section'

type Props = { events: TicketView['events']; repo: string; files?: TicketView['commentFiles'] }

const ICONS: Record<EventView['kind'], LucideIcon> = {
  run: Play,
  owner: User,
  factory: Bot,
  criteria: CircleMinus,
  other: Dot,
}
const KIND_WORDS: Record<EventView['kind'], string> = {
  run: 'Run',
  owner: 'Your decision',
  factory: 'Factory decision',
  criteria: 'Criteria',
  other: 'Event',
}
const TILES: Record<EventView['tone'], string> = {
  neutral: 'bg-secondary text-muted-foreground',
  ok: 'bg-success-soft text-success',
  warn: 'bg-warn-soft text-warn',
  error: 'bg-danger-soft text-danger',
}
const BADGES = { neutral: 'neutral', ok: 'ok', warn: 'warn', error: 'destructive' } as const

function Row({ event, repo }: { event: EventView; repo: string }) {
  const Icon = ICONS[event.kind]
  const tile = event.kind === 'run' && event.tone === 'neutral' ? 'bg-accent text-primary' : TILES[event.tone]
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-t border-border py-2.5 first:border-t-0">
      <span className={cn('flex size-7 items-center justify-center rounded-lg', tile)}>
        <Icon className="size-4" />
        <span className="sr-only">{KIND_WORDS[event.kind]}</span>
      </span>
      <div className="grid min-w-0 gap-1">
        <span>
          <RefText text={event.label} repo={repo} />
        </span>
        <span className="small flex flex-wrap items-center gap-2 text-muted-foreground">
          <Time iso={event.at} className="mono" />
          {event.state && <Badge variant={BADGES[event.tone]}>{event.state}</Badge>}
          {event.enters && <Badge variant="outline">Now in {STAGE_NAMES[event.enters]}</Badge>}
        </span>
      </div>
    </li>
  )
}

export function ActivityList({ events, repo, files = [] }: Props) {
  return (
    <Card>
      <h2 className="heading">Timeline</h2>
      {files.length > 0 && (
        <ul aria-label="Files attached to comments" className="m-0 flex list-none flex-wrap gap-3 p-0">
          {files.map((file) => (
            <li key={file.id}>
              <a href={fileUrl(file.conversationId, file.id)} className="underline">
                {file.name}
              </a>
            </li>
          ))}
        </ul>
      )}
      <ol aria-label="Ticket timeline" className="m-0 grid list-none p-0">
        {events.map((event) => (
          <Row key={event.id} event={event} repo={repo} />
        ))}
      </ol>
    </Card>
  )
}
