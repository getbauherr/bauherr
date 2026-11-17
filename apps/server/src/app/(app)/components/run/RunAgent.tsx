import Link from 'next/link'
import type { RunDoc, SessionInfo } from '../../lib/run'
import { shortModel } from '../../lib/format'
import { RoleAvatar } from '../team/RoleAvatar'
import { Panel } from './Panel'

type Role = { title: string; avatar: string } | undefined
type AdminInfo = { owner: string | null; agentKeyLabel: string | null }

const Row = ({ k, v, title }: { k: string; v: string; title?: string }) => <div className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="mono m-0 break-words" title={title}>{v}</dd></div>

/** Who works the Run: role and session (linking the Agent view), "Runner" or "CI" for an autonomous one. Admin adds client, model, provider, owner and agent key, and the Run's tokens and cost until the Cost panel lands. */
export function RunAgent({ run, session, role, admin, animate, className }: { run: RunDoc; session: SessionInfo | null; role: Role; admin: AdminInfo | null; animate: boolean; className?: string }) {
  const name = session ? (session.label ?? session.publicId) : run.mode === 'session' ? (run.sessionLabel ?? 'Session') : run.executor === 'ci' ? 'CI' : 'Runner'
  const info = admin && { client: [session?.clientName ?? run.clientName, session?.clientVersion ?? run.clientVersion].filter(Boolean).join(' '), model: session?.model ?? run.model, provider: session?.provider ?? run.provider }
  return (
    <Panel id="run-agent" title="Agent" className={className}>
      <p className="m-0 flex items-center gap-3">
        {role && <RoleAvatar avatar={role.avatar} size="sm" animate={animate} />}
        <span className="flex min-w-0 flex-col">
          {role && <span className="small text-muted-foreground">{role.title}</span>}
          {session ? <Link className="mono inline-flex min-h-6 items-center break-words text-primary" href={`/team/${session.publicId}`}>{name}</Link> : <span className="mono break-words">{name}</span>}
        </span>
      </p>
      {admin && info && (
        <dl className="small m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 [&_dd]:m-0">
          {info.client && <Row k="Client" v={info.client} />}
          {info.model && <Row k="Model" v={shortModel(info.model)} title={info.model} />}
          {info.provider && <Row k="Provider" v={info.provider} />}
          {admin.owner && <Row k="Owner" v={admin.owner} />}
          {admin.agentKeyLabel && <Row k="Agent key" v={admin.agentKeyLabel} />}
          <Row k="Tokens in / out / cache" v={`${run.tokensIn ?? 0} / ${run.tokensOut ?? 0} / ${run.tokensCache ?? 0}`} />
          {(run.gatewayTokensIn != null || run.gatewayTokensOut != null) && <Row k="Gateway tokens in / out" v={`${run.gatewayTokensIn ?? 0} / ${run.gatewayTokensOut ?? 0}`} />}
          <Row k="Cost" v={run.reconcileStatus === 'unpriced' ? `${run.gatewayTokensTotal ?? 0} tokens, unpriced` : run.costUsd != null ? `$${run.costUsd.toFixed(4)} (${run.costSource ?? 'sdk-estimate'})` : '—'} />
        </dl>
      )}
    </Panel>
  )
}
