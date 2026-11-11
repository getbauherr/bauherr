import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ago, duration } from '../../lib/format'
import { CopyButton } from './CopyButton'
import { clock, defaultConnectPrompt } from './helpers'
import { RoleAvatar } from './RoleAvatar'
import type { ConnectPrompt, TeamRole, TeamSession } from './types'

const WORD = { working: 'Working', idle: 'Idle', offline: 'Offline' } as const

function Dot({ status }: { status: TeamSession['status'] }) {
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', status === 'working' ? 'bg-primary' : status === 'idle' ? 'bg-muted-foreground' : 'border border-muted-foreground')} />
}

function Row({ role, s }: { role: TeamRole; s: TeamSession }) {
  const client = [s.clientName, s.clientVersion].filter(Boolean).join(' ')
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-3 last:border-b-0">
      <span className="flex w-28 shrink-0 items-center gap-2">
        {s.status === 'working' ? <RoleAvatar avatar={role.avatar} size="sm" animate /> : <Dot status={s.status} />}
        <span className="small">{WORD[s.status]}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{s.label}</span>
        <span className="small truncate text-muted-foreground">{[client, s.model].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="small min-w-0 basis-64">
        {s.ticket ? (
          <>
            <Link className="text-primary" href={`/tickets/n/${s.ticket.number}`}>#{s.ticket.number} {s.ticket.title}</Link>
            <span className="text-muted-foreground"> · {s.ticket.stage}</span>
          </>
        ) : <span className="text-muted-foreground">No ticket</span>}
      </span>
      <span className="small mono w-44 text-right text-muted-foreground">
        <span className="block">active today {duration(s.activeSecondsToday)}</span>
        <span className="block">{s.status === 'offline' ? `last seen ${ago(s.lastSeenAt)}` : `connected ${clock(s.connectedAt)}`}</span>
      </span>
    </li>
  )
}

function Autonomous({ role, a, now }: { role: TeamRole; a: TeamRole['autonomous'][number]; now: number }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-3 last:border-b-0">
      <span className="flex w-28 shrink-0 items-center gap-2">
        <RoleAvatar avatar={role.avatar} size="sm" animate />
        <span className="small">Working</span>
      </span>
      <span className="flex-1 font-medium">{a.executor === 'ci' ? 'CI' : 'Runner'}</span>
      <span className="small min-w-0 basis-64">
        <Link className="text-primary" href={`/tickets/n/${a.ticket.number}`}>#{a.ticket.number} {a.ticket.title}</Link>
      </span>
      <span className="small mono w-44 text-right text-muted-foreground">running {duration((now - +new Date(a.since)) / 1000)}</span>
    </li>
  )
}

export function SessionList({ roles, connectPrompt = defaultConnectPrompt, now = Date.now() }: { roles: TeamRole[]; connectPrompt?: ConnectPrompt; now?: number }) {
  return (
    <div className="flex flex-col gap-6">
      {roles.map((role) => (
        <section key={role.id} aria-labelledby={`sessions-${role.id}`} className="flex flex-col gap-2">
          <h3 id={`sessions-${role.id}`} className="heading">{role.title}</h3>
          {role.sessions.length || role.autonomous.length ? (
            <ul className="m-0 list-none rounded-md border border-border bg-card p-0">
              {role.sessions.map((s) => <Row key={s.publicId} role={role} s={s} />)}
              {role.autonomous.map((a) => <Autonomous key={a.runId} role={role} a={a} now={now} />)}
            </ul>
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-4 py-3">
              <span className="small text-muted-foreground">No session connected</span>
              <CopyButton text={connectPrompt(role)} label="Copy connect prompt" />
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
