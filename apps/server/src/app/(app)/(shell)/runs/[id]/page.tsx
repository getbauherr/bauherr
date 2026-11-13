import { PageTitle } from '../../../components/PageTitle'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ListView, TimelineView } from '../../../components/RunViews'
import { FormPending, NextStepBar } from '../../../components/NextStepBar'
import { RelinkMr } from '../../../components/FixState'
import { Markdown } from '../../../components/Markdown'
import { StatusChip } from '../../../components/StatusChip'
import { Badge } from '../../../components/ui/badge'
import { Card } from '../../../components/ui/card'
import { Tab, Tabs } from '../../../components/ui/tabs'
import { releaseRunLock, rerunStage } from '../../../lib/actions'
import { RERUNNABLE, durationMs, fmtDuration, loadRun } from '../../../lib/run'
import { renderMarkdown } from '../../../lib/markdown'
import { currentWorkspace } from '../../../lib/session'
import { isWebUrl } from '../../../lib/url'
import { kindOfRun } from '../../../../../lib/stage-text'
import { workflowFor } from '../../../../../lib/factory'

export const dynamic = 'force-dynamic'

const TABS = ['timeline', 'list'] as const

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; notice?: string }> }) {
  const { id } = await params
  const { tab: raw, notice } = await searchParams
  const tab = TABS.find((t) => t === raw) ?? 'timeline'
  const { user, workspace } = await currentWorkspace()
  if (!workspace) notFound()
  const admin = user.role === 'admin'
  const { run, ticket, steps, stepsTotal, callsByStep, owner, agentKeyLabel, chain } = await loadRun(workspace.id, id, admin)
  const prUrl = run.artifacts?.prUrl
  const leased = run.mode === 'session' && run.status === 'running'
  const rerun = RERUNNABLE.includes(run.status)
  const details: [string, React.ReactNode][] = [
    ['Launched by', run.mode === 'session' ? (owner ?? 'session') : 'scheduler'],
    ...(agentKeyLabel ? [['Claimed by', `agent key ${agentKeyLabel}`] as [string, React.ReactNode]] : []),
    ['Started', run.startedAt?.slice(0, 19).replace('T', ' ') ?? '—'],
    ['Ended', run.finishedAt?.slice(0, 19).replace('T', ' ') ?? '—'],
    ['Duration', fmtDuration(durationMs(run.startedAt, run.finishedAt))],
    ['Status', <StatusChip key="s" status={run.status} />],
    ['Kind', run.kind ?? kindOfRun(workflowFor(run.workspace), run) ?? '—'],
    ['Outcome', run.outcome ?? '—'],
    ['Goal', Array.isArray(run.goal) && run.goal.length ? <ul key="goal" className="m-0 list-disc pl-4">{run.goal.map((g, i) => <li key={i}>{g}</li>)}</ul> : '—'],
    ['Executor', run.executor ?? run.mode],
    ['Session', run.sessionLabel ?? '—'],
    ['Client', [run.clientName, run.clientVersion].filter(Boolean).join(' ') || '—'],
    ['Model', run.model ?? '—'],
    ['Provider', run.provider ?? '—'],
    ['Tokens in/out/cache', `${run.tokensIn ?? 0} / ${run.tokensOut ?? 0} / ${run.tokensCache ?? 0}`],
    ['Gateway tokens in/out', run.gatewayTokensIn == null && run.gatewayTokensOut == null ? '—' : `${run.gatewayTokensIn ?? 0} / ${run.gatewayTokensOut ?? 0}`],
    ['Cost', run.reconcileStatus === 'unpriced' ? `${run.gatewayTokensTotal ?? 0} tokens, unpriced` : run.costUsd != null ? `$${run.costUsd.toFixed(4)} (${run.costSource ?? 'sdk-estimate'})` : '—'],
  ]
  return (
    <>
      {(rerun || (admin && leased)) && (
        <NextStepBar
          sentence={rerun ? `This ${run.stage} Run ended as ${run.status}. Start it again when ready.` : `This Run holds a lock. Release it if the session is gone.`}
          primary={rerun ? { label: 'Re-run stage', confirm: `Confirm re-run ${run.stage}`, form: 'run-action' } : { label: 'Release lock', confirm: `Confirm release lock on run ${run.id}`, form: 'run-action' }}
        >
          <form id="run-action" action={rerun ? rerunStage.bind(null, run.id) : releaseRunLock.bind(null, run.id)}><FormPending /></form>
        </NextStepBar>
      )}
      <header className="flex flex-col gap-4">
        <PageTitle>{`#${ticket.number} Run ${run.id}`}</PageTitle>
        <h1 className="title">#{ticket.number} {ticket.title}</h1>
        <p className="body"><StatusChip status={run.status} /> <span className="text-muted-foreground">{run.stage}</span></p>
        {run.preemptedFor && (run.preemptAt || run.reasonKind === 'preempted') && <p className="body" role="status">Preempted by #{run.preemptedFor}</p>}
        {notice === 'active' && <p className="body" role="status">A Run is already active for this stage</p>}
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6 max-sm:grid-cols-[minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {run.verdict && (
            <Card asChild className="gap-4">
              <section aria-label="Review">
                <h2 className="label text-muted-foreground">Review verdict <Badge variant={run.verdict === 'clean' ? 'ok' : 'warn'}>{run.verdict === 'clean' ? 'Clean' : 'Changes requested'}</Badge></h2>
                {run.findings?.length ? (
                  <ul className="m-0 flex list-none flex-col gap-4 p-0" aria-label="Findings">
                    {run.findings.map((f, i) => (
                      <li key={i} className="small">
                        <Badge variant={f.severity === 'low' ? 'neutral' : 'destructive'}>{f.severity}</Badge> <span className="mono">{f.file}:{f.line}</span> {f.msg}
                        <div className="text-muted-foreground">Scenario: {f.scenario}</div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="small text-muted-foreground">No findings.</p>}
              </section>
            </Card>
          )}
          {admin && (
            <>
          <Tabs className="border-b border-border" aria-label="Run view">
            {TABS.map((t) => <Tab key={t} href={`?tab=${t}`} aria-current={t === tab ? 'page' : undefined}>{t[0]!.toUpperCase() + t.slice(1)}</Tab>)}
          </Tabs>
          {tab === 'timeline' && <TimelineView run={run} steps={steps} calls={callsByStep} now={Date.now()} />}
          {tab === 'list' && <ListView run={run} steps={steps} total={stepsTotal} calls={callsByStep} />}
            </>
          )}
        </div>
        <Card asChild className="gap-4">
        <aside>
          {admin && (
            <details aria-label="Details">
              <summary className="label text-muted-foreground">Details</summary>
              <dl className="m-0 mt-2 flex flex-col gap-2 [&_dd]:m-0">
                {details.map(([k, v]) => <div key={k}><dt className="label text-muted-foreground">{k}</dt><dd className="mono">{v}</dd></div>)}
              </dl>
            </details>
          )}
          {(chain.previous || chain.next.length > 0) && (
            <ul aria-label="Run chain" className="small m-0 flex list-none flex-col gap-1 p-0">
              {chain.previous && <li>Continues <Link className="text-primary" href={`/runs/${chain.previous}`}>Run #{chain.previous}</Link></li>}
              {chain.next.map((n) => <li key={n}>Continued by <Link className="text-primary" href={`/runs/${n}`}>Run #{n}</Link></li>)}
            </ul>
          )}
          {run.evidence && <div><h2 className="label text-muted-foreground">Evidence</h2><Markdown className="small" html={renderMarkdown(run.evidence)} /></div>}
          {run.error && <p className="text-destructive">{run.error}</p>}
          <p className="flex flex-wrap items-center justify-between gap-3">
            <Link className="text-primary" href={`/tickets/${ticket.id}#steps`}>Ticket #{ticket.number}, its steps</Link>
            {isWebUrl(prUrl) && <a className="text-primary" href={prUrl}>Merge request</a>}
          </p>
          {admin && kindOfRun(workflowFor(run.workspace), run) === 'build' && <RelinkMr run={run.id} />}
        </aside>
        </Card>
      </div>
    </>
  )
}
