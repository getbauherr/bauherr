import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ago, durationHm } from '../../lib/format'
import { CopyButton } from './CopyButton'
import { connectPrompt } from './helpers'
import { RoleAvatar } from './RoleAvatar'
import type { TeamRole, TeamSession } from './types'

const WORD = { working: 'Working', idle: 'Idle', offline: 'Offline' } as const

function Dot({ status }: { status: TeamSession['status'] }) {
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', status === 'working' ? 'bg-primary' : status === 'idle' ? 'bg-muted-foreground' : 'border border-muted-foreground')} />
}

const Ticket = ({ number, title, stage }: { number: number; title: string; stage?: string }) => (
  <span className="small min-w-0 basis-64">
    <Link className="text-primary" href={`/tickets/n/${number}`}>#{number} {title}</Link>
    {stage && <span className="text-muted-foreground capitalize"> · {stage}</span>}
  </span>
)

function Row({ avatar, s, role, titles }: { avatar?: string; s: TeamSession; role?: string; titles: Record<string, string> }) {
  const client = [s.clientName, s.clientVersion].filter(Boolean).join(' ')
  return (
    <li id={s.publicId} className="flex scroll-mt-20 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-3 target:bg-accent last:border-b-0" data-testid="session-row" data-status={s.status}>
      <span className="flex w-28 shrink-0 items-center gap-2">
        {s.status === 'working' && avatar ? <RoleAvatar avatar={avatar} size="sm" animate /> : <Dot status={s.status} />}
        <span className="small">{WORD[s.status]}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{s.label ?? s.publicId}{role && <span className="small font-normal text-muted-foreground"> ({role})</span>}</span>
        <span className="small truncate text-muted-foreground">{[client, s.model].filter(Boolean).join(' · ')}</span>
      </span>
      {s.ticket ? <Ticket number={s.ticket.number} title={s.ticket.title} stage={titles[s.ticket.stage]} /> : <span className="small min-w-0 basis-64 text-muted-foreground">No ticket</span>}
      <span className="small w-44 text-right text-muted-foreground">
        {s.activeSecondsToday > 0 && <span className="mono block">active today {durationHm(s.activeSecondsToday)}</span>}
        {s.status === 'offline' ? s.lastSeenAt && <span className="block" title={s.lastSeenAt}>last seen {ago(s.lastSeenAt)}</span> : s.connectedAt && <span className="block" title={s.connectedAt}>connected {ago(s.connectedAt)}</span>}
      </span>
    </li>
  )
}

function Autonomous({ role, a, now, titles }: { role: TeamRole; a: TeamRole['autonomous'][number]; now: number; titles: Record<string, string> }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-3 last:border-b-0" data-testid="session-row" data-status="working">
      <span className="flex w-28 shrink-0 items-center gap-2">
        <RoleAvatar avatar={role.avatar} size="sm" animate />
        <span className="small">Working</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{a.executor === 'ci' ? 'CI' : 'Runner'} <span className="small font-normal text-muted-foreground">({role.title})</span></span>
        {a.model && <span className="small truncate text-muted-foreground">{a.model}</span>}
      </span>
      <Ticket number={a.ticket.number} title={a.ticket.title} stage={titles[a.ticket.stage]} />
      <span className="small mono w-44 text-right text-muted-foreground">{a.startedAt ? `running ${durationHm((now - +new Date(a.startedAt)) / 1000)}` : ''}</span>
    </li>
  )
}

const List = ({ children }: { children: React.ReactNode }) => <ul className="m-0 list-none rounded-md border border-border bg-card p-0">{children}</ul>

export function SessionList({ roles, orphans = [], now = Date.now() }: { roles: TeamRole[]; orphans?: (TeamSession & { role: string })[]; now?: number }) {
  const titles = Object.fromEntries(roles.flatMap((r) => r.stages.map((x) => [x.name, x.title])))
  return (
    <div className="flex flex-col gap-6">
      {roles.map((role) => (
        <section key={role.id} aria-labelledby={`sessions-${role.id}`} className="flex flex-col gap-2">
          <h3 id={`sessions-${role.id}`} className="heading">{role.title}</h3>
          {role.sessions.length || role.autonomous.length ? (
            <List>
              {role.sessions.map((s) => <Row key={s.publicId} avatar={role.avatar} s={s} titles={titles} />)}
              {role.autonomous.map((a) => <Autonomous key={a.run} role={role} a={a} now={now} titles={titles} />)}
            </List>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
              <span className="small text-muted-foreground">No session connected</span>
              <CopyButton text={connectPrompt(role)} label="Copy connect prompt" />
            </div>
          )}
        </section>
      ))}
      {orphans.length > 0 && (
        <section aria-labelledby="sessions-orphans" className="flex flex-col gap-2" data-testid="orphans">
          <h3 id="sessions-orphans" className="heading">Sessions without a role</h3>
          <p className="small m-0 text-muted-foreground">Their role is no longer in the workflow. They receive no work.</p>
          <List>{orphans.map((s) => <Row key={s.publicId} s={s} role={s.role} titles={titles} />)}</List>
        </section>
      )}
    </div>
  )
}
