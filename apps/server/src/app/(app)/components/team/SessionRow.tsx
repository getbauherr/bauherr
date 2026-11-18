import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { TeamCost } from '../../lib/cost'
import { StatusChip } from '../StatusChip'
import { Badge } from '../ui/badge'
import { ago } from '../../lib/format'
import { usd } from '../insights/CostSection'
import { AgentLink } from './AgentNav'
import { RoleAvatar } from './RoleAvatar'
import type { ListRow } from './helpers'

const cap = (word: string) => (!word || word === 'running a step' ? 'Working' : `${word[0]!.toUpperCase()}${word.slice(1)}`)

const Ticket = ({ number, title }: { number: number; title: string }) => (
  <span className="small min-w-0 basis-64 truncate"><Link className="text-primary" href={`/tickets/n/${number}`}>#{number} {title}</Link></span>
)

const Since = ({ at, label }: { at: string | null; label?: string }) =>
  at ? <time className="small w-24 shrink-0 text-muted-foreground" dateTime={at} title={new Date(at).toLocaleString('en-GB')}>{label}{ago(at)}</time> : <span className="w-24 shrink-0" />

export function SessionRow({ row, costs }: { row: Exclude<ListRow, { kind: 'needs' }>; costs?: TeamCost['sessions'] }) {
  if (row.kind === 'autonomous') {
    const { role, run } = row
    return (
      <li className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-3 last:border-b-0" data-testid="session-row" data-status="working">
        <Name avatar={role.avatar} animate name={run.executor === 'ci' ? 'CI' : 'Runner'} role={role.title} />
        <span className="w-36 shrink-0"><StatusChip status="running" label={cap(role.stages.find((s) => s.name === run.ticket.stage)?.activity ?? '')} /></span>
        <Ticket number={run.ticket.number} title={run.ticket.title} />
        <Since at={run.startedAt} />
        {costs && <span className="w-16 shrink-0" />}
      </li>
    )
  }
  const { session: s, role } = row
  const working = s.status === 'working'
  const gone = s.health === 'disconnected'
  return (
    <li id={s.publicId} className={cn('flex scroll-mt-20 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-3 target:bg-accent last:border-b-0', !working && 'text-muted-foreground')} data-testid="session-row" data-status={s.status} data-health={s.health}>
      <Name avatar={role?.avatar} animate={working} name={s.label ?? s.publicId} role={role?.title ?? row.orphanRole} muted={!working} href={`/team/${s.publicId}`} />
      <span className="w-36 shrink-0">{working && s.health === 'working' ? <StatusChip status="running" label={cap(s.activity ?? '')} /> : s.health === 'stuck' ? <Badge variant="warn">Stuck</Badge> : s.health === 'not-responding' ? <Badge variant="warn">Not responding</Badge> : gone ? <Badge variant="muted">Disconnected</Badge> : <span className="small">Idle</span>}</span>
      {s.ticket ? <Ticket number={s.ticket.number} title={s.ticket.title} /> : <span className="small min-w-0 basis-64">No ticket</span>}
      <Since at={working ? s.runStartedAt ?? null : gone ? s.disconnectedAt : s.lastSeenAt} />
      {costs && <span className="mono w-16 shrink-0 text-right" data-testid="session-cost">{usd(costs[s.publicId]?.today ?? 0)}</span>}
    </li>
  )
}

function Name({ avatar, animate, name, role, muted, href }: { avatar?: string; animate: boolean; name: string; role?: string; muted?: boolean; href?: string }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      {avatar ? <RoleAvatar avatar={avatar} size="sm" animate={animate} /> : <span className="size-8 shrink-0" aria-hidden />}
      <span className={cn('truncate font-medium', !muted && 'text-foreground')}>{href ? <AgentLink className="hover:underline" href={href}>{name}</AgentLink> : name}{role && <span className="small font-normal text-muted-foreground"> · {role}</span>}</span>
    </span>
  )
}
