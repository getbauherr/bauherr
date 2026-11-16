import Link from 'next/link'
import { Card } from '../ui/card'
import { Badge } from '../ui/badge'
import { ago, durationHm, tok, usd } from '../../lib/format'
import type { SessionView } from '../../../../lib/sessions'
import { agentStatus } from './agent-status'
import { AgentActions } from './AgentActions'
import { AgentRuns } from './AgentRuns'
import { BackLink } from './AgentNav'
import { RoleAvatar } from './RoleAvatar'
import type { SaveResult } from './types'

const TONE = { working: 'accent', idle: 'neutral', stuck: 'warn', 'not-responding': 'warn', disconnected: 'muted' } as const
const WORD = { working: 'Working', idle: 'Idle', stuck: 'Stuck', 'not-responding': 'Not responding', disconnected: 'Disconnected' } as const

type Props = {
  view: SessionView
  role: { title: string; avatar: string }
  /** Stage name to title. */
  titles: Record<string, string>
  admin: boolean
  now?: number
  disconnect: (publicId: string) => Promise<SaveResult>
  release: (publicId: string) => Promise<SaveResult>
}

const Panel = ({ label, children, ...rest }: { label: string; children: React.ReactNode } & React.ComponentProps<'section'>) => (
  <Card asChild className="gap-3">
    <section aria-label={label} {...rest}>
      <h2 className="label text-muted-foreground">{label}</h2>
      {children}
    </section>
  </Card>
)

export function AgentView({ view, role, titles, admin, now = Date.now(), disconnect, release }: Props) {
  const { session: s, runs, milestones, usage } = view
  const name = s.label ?? s.publicId
  const identity = admin ? [[s.clientName, s.clientVersion].filter(Boolean).join(' '), s.model, s.provider].filter(Boolean).join(' · ') : ''
  const canDisconnect = admin && s.health !== 'disconnected'
  const canRelease = admin && !!s.run && (s.health === 'stuck' || s.health === 'disconnected')
  const details: [string, React.ReactNode][] = [
    ['Session id', s.publicId],
    ...(admin && s.keyOwner ? [['Key owner', s.keyOwner] as [string, React.ReactNode]] : []),
    ['Connected since', s.connectedAt ? <span title={s.connectedAt}>{ago(s.connectedAt)}</span> : '—'],
    ['Last seen', s.lastSeenAt ? <span title={s.lastSeenAt}>{ago(s.lastSeenAt)}</span> : '—'],
    ...(s.disconnectedAt ? [['Ended', <span key="e" title={s.disconnectedAt}>{ago(s.disconnectedAt)}{s.endReason && `, ${s.endReason}`}</span>] as [string, React.ReactNode]] : []),
  ]
  return (
    <div className="flex flex-col gap-6">
      <BackLink className="small text-primary" />
      <header className="flex flex-wrap items-start gap-4">
        <span className="shrink-0"><RoleAvatar avatar={role.avatar} size="lg" animate={s.health === 'working'} /></span>
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
          <h1 className="title m-0 break-words" data-testid="agent-name">{name} <span className="small font-normal text-muted-foreground">({role.title})</span></h1>
          {identity && <p className="small m-0 text-muted-foreground" data-testid="agent-identity">{identity}</p>}
          <p className="body m-0 flex flex-wrap items-center gap-2" role="status" data-testid="agent-status"><Badge variant={TONE[s.health]}>{WORD[s.health]}</Badge>{agentStatus(view, now)}</p>
        </div>
        {(canDisconnect || canRelease) && <AgentActions name={name} disconnect={canDisconnect ? disconnect.bind(null, s.publicId) : undefined} release={canRelease ? release.bind(null, s.publicId) : undefined} />}
      </header>
      {s.run && s.ticket && (
        <Panel label="Current Run" data-testid="current-run">
          <p className="body m-0"><Link className="text-primary" href={`/tickets/n/${s.ticket.number}`}>#{s.ticket.number} {s.ticket.title}</Link></p>
          <p className="small m-0 text-muted-foreground">{titles[s.ticket.stage] ?? s.ticket.stage}{s.activity && ` · ${s.activity}`}{s.runStartedAt && <> · started <span title={s.runStartedAt}>{ago(s.runStartedAt)}</span></>} · <Link className="text-primary" href={`/runs/${s.run}`}>Run #{s.run}</Link></p>
        </Panel>
      )}
      {usage && (
        <Panel label="Cost" data-testid="agent-cost">
          <dl className="small m-0 grid grid-cols-[max-content_1fr_1fr] gap-x-6 gap-y-1 [&_dd]:m-0">
            {([['Today', usage.today], ['30 days', usage.d30]] as const).map(([k, u]) => (
              <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="mono">{usd(u.usd)}</dd><dd className="mono">{tok(u.tokens)} tokens</dd></div>
            ))}
          </dl>
        </Panel>
      )}
      <Panel label="Milestones" data-testid="agent-milestones">
        {milestones.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {milestones.map((m, i) => (
              <li key={i} className="small flex flex-wrap items-baseline gap-x-3">
                <span className="min-w-0 flex-1">{m.summary ?? `Step ${m.seq ?? ''}`.trim()}</span>
                {m.at && <span className="text-muted-foreground" title={m.at}>{ago(m.at)}</span>}
                <Link className="text-primary" href={`/runs/${m.run}`}>Run #{m.run}</Link>
              </li>
            ))}
          </ul>
        ) : <p className="small m-0 text-muted-foreground">No milestones yet.</p>}
      </Panel>
      <Panel label="Runs" data-testid="agent-runs-panel">
        {runs.length ? <AgentRuns runs={runs} titles={titles} admin={admin} /> : <p className="small m-0 text-muted-foreground">No Runs yet.</p>}
      </Panel>
      <details className="rounded-md border border-border bg-card p-4" data-testid="agent-details">
        <summary className="label cursor-pointer text-muted-foreground">Details</summary>
        <dl className="small m-0 mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 [&_dd]:m-0">
          {details.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="mono break-all">{v}</dd></div>)}
          {s.activeSecondsTotal > 0 && <div className="contents"><dt className="text-muted-foreground">Active time</dt><dd className="mono">{durationHm(s.activeSecondsTotal)}</dd></div>}
        </dl>
      </details>
    </div>
  )
}
