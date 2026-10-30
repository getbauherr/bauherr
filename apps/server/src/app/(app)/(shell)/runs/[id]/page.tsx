import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GraphView, ListView, TimelineView } from '../../../components/RunViews'
import { ConfirmButton } from '../../../components/SettingsForm'
import { StagePipeline } from '../../../components/StagePipeline'
import { StatusChip } from '../../../components/StatusChip'
import { rerunStage } from '../../../lib/actions'
import type { Stage } from '../../../lib/needs-you'
import { RERUNNABLE, durationMs, fmtDuration, loadRun } from '../../../lib/run'
import { renderMarkdown } from '../../../lib/markdown'
import { currentWorkspace } from '../../../lib/session'
import { isWebUrl } from '../../../lib/url'

export const dynamic = 'force-dynamic'

const TABS = ['graph', 'timeline', 'list'] as const

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; notice?: string }> }) {
  const { id } = await params
  const { tab: raw, notice } = await searchParams
  const tab = TABS.find((t) => t === raw) ?? 'graph'
  const { user, workspace } = await currentWorkspace()
  if (!workspace) notFound()
  const { run, ticket, stages, latestByStage, steps, stepsTotal, callsByStep, owner } = await loadRun(workspace.id, id)
  const prUrl = run.artifacts?.prUrl
  const rerun = RERUNNABLE.includes(run.status)
  const mayShowOwner = user.role === 'admin' || (user.tenants ?? []).some((t) => (typeof t.tenant === 'object' ? t.tenant?.id : t.tenant) === run.workspace)
  const details: [string, React.ReactNode][] = [
    ['Launched by', run.mode === 'session' ? (mayShowOwner && owner ? owner : 'session') : 'scheduler'],
    ['Started', run.startedAt?.slice(0, 19).replace('T', ' ') ?? '—'],
    ['Ended', run.finishedAt?.slice(0, 19).replace('T', ' ') ?? '—'],
    ['Duration', fmtDuration(durationMs(run.startedAt, run.finishedAt))],
    ['Status', <StatusChip key="s" status={run.status} />],
    ['Model', run.model ?? '—'],
    ['Tokens in/out/cache', `${run.tokensIn ?? 0} / ${run.tokensOut ?? 0} / ${run.tokensCache ?? 0}`],
    ['Cost', run.costUsd != null ? `$${run.costUsd.toFixed(4)} (${run.costSource ?? 'sdk-estimate'})` : '—'],
  ]
  return (
    <>
      <header className="stack">
        <h1 className="title">Run {run.id} · #{ticket.number} {ticket.title}</h1>
        <p className="body row-between"><span><StatusChip status={run.status} /> <span className="label muted">{run.mode}</span></span></p>
        <StagePipeline current={run.stage as Stage} />
        {notice === 'active' && <p className="body" role="status">A Run is already active for this stage</p>}
      </header>
      <div className="runpage">
        <div className="stack">
          <nav className="tabs controls" aria-label="Run view">
            {TABS.map((t) => <Link key={t} href={`?tab=${t}`} aria-current={t === tab ? 'page' : undefined}>{t[0]!.toUpperCase() + t.slice(1)}</Link>)}
          </nav>
          {tab === 'graph' && <GraphView run={run} stages={stages} latestByStage={latestByStage} />}
          {tab === 'timeline' && <TimelineView run={run} steps={steps} calls={callsByStep} now={Date.now()} />}
          {tab === 'list' && <ListView run={run} steps={steps} total={stepsTotal} calls={callsByStep} />}
        </div>
        <aside className="card-lg stack" aria-label="Details">
          <dl className="dl">
            {details.map(([k, v]) => <div key={k}><dt className="label muted">{k}</dt><dd className="mono">{v}</dd></div>)}
          </dl>
          {run.evidence && <div><h2 className="label muted">Evidence</h2><div className="md small" dangerouslySetInnerHTML={{ __html: renderMarkdown(run.evidence) }} /></div>}
          {run.error && <p className="err">{run.error}</p>}
          <p className="row-between">
            <Link className="link" href={`/tickets/${ticket.id}`}>Ticket #{ticket.number}</Link>
            {isWebUrl(prUrl) && <a className="link" href={prUrl}>Merge request</a>}
          </p>
          {rerun && (
            <form action={rerunStage.bind(null, run.id)} className="sform"><div className="actions"><ConfirmButton label="Re-run stage" confirm={`Confirm re-run ${run.stage}`} /></div></form>
          )}
        </aside>
      </div>
    </>
  )
}
