import { ciSummaryOf } from '../../../../../lib/ci-summary'
import { forgeLinkOf } from '../../../../../lib/ci-text'
import { runHealth } from '../../../../../lib/run-health'
import { sessionTimeoutS } from '../../../../../lib/sessions'
import { kindOfRun } from '../../../../../lib/stage-text'
import { roleOf } from '../../../../../lib/workflow'
import { workflowFor } from '../../../../../lib/factory'
import { CiPanel } from '../../../components/CiPanel'
import { ForgeLink } from '../../../components/ForgeLink'
import { RelinkMr } from '../../../components/FixState'
import { Markdown } from '../../../components/Markdown'
import { FormPending, NextStepBar, type NextStepPrimary } from '../../../components/NextStepBar'
import { PageTitle } from '../../../components/PageTitle'
import { ReleaseLock } from '../../../components/run/ReleaseLock'
import { RunAgent } from '../../../components/run/RunAgent'
import { RunLinks } from '../../../components/run/RunLinks'
import { RunRelations } from '../../../components/run/RunRelations'
import { RunStatusLine } from '../../../components/run/RunStatusLine'
import { RunTimeline } from '../../../components/run/RunTimeline'
import { RunTimes } from '../../../components/run/RunTimes'
import { Sentence } from '../../../components/run/Sentence'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import { releaseRunLock, rerunStage } from '../../../lib/actions'
import { renderMarkdown } from '../../../lib/markdown'
import { forgeKinds } from '../../../lib/overview'
import { loadRun } from '../../../lib/run'
import { runLinks } from '../../../lib/run-view'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

/** Phone order of the panels (Links right after the header); written out so Tailwind finds the classes. */
const ORDER = { links: 'max-sm:order-1', ci: 'max-sm:order-2', timeline: 'max-sm:order-3', proof: 'max-sm:order-4', goal: 'max-sm:order-5', agent: 'max-sm:order-6', relations: 'max-sm:order-7', times: 'max-sm:order-8' }

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bars?: string; notice?: string }> }) {
  const { id } = await params
  const { bars, notice } = await searchParams
  const { user, workspace } = await currentWorkspace()
  if (!workspace) notFound()
  const admin = user.role === 'admin'
  const { run, ticket, session, connected, steps, stepsTotal, admin: adminData, chain } = await loadRun(workspace.id, id, admin)
  const now = Date.now()
  const wf = workflowFor(run.workspace)
  const health = runHealth({ run, session, ticket, connected, isAdmin: admin, now, timeoutS: sessionTimeoutS(), wf })
  const ci = ciSummaryOf(ticket)
  const forge = (await forgeKinds(await payloadClient(), workspace.id)).get(ticket.product)
  const forgeLink = forgeLinkOf(forge, ci?.summary.url ?? run.artifacts?.prUrl)
  const role = roleOf(wf, run.stage)
  const { action } = health
  const primary: NextStepPrimary | undefined =
    action?.kind === 'connect' ? { label: 'Connect an agent', href: action.href }
    : action?.kind === 'open_ticket' && health.state === 'needs_human' ? { label: 'Open ticket', href: action.href }
    : action?.kind === 'rerun' ? { label: `Re-run ${action.stage}`, confirm: `Confirm re-run ${action.stage}`, form: 'run-action' }
    : undefined
  const sessionName = session?.label ?? run.sessionLabel
  const releaseWhy = `${sessionName ? `Session ${sessionName}` : 'The session'} ${health.state === 'stuck' ? 'is not responding.' : 'is gone.'}`
  return (
    <>
      {action && (
        <NextStepBar sentence={<Sentence text={health.sentence} />} primary={primary}>
          {action.kind === 'rerun' && <form id="run-action" action={rerunStage.bind(null, run.id)}><FormPending /></form>}
          {action.kind === 'release' && <ReleaseLock runId={run.id} why={releaseWhy} action={releaseRunLock.bind(null, run.id)} />}
          {action.kind === 'open_ticket' && !primary && <Button asChild variant="outline"><a href={action.href}>Open ticket</a></Button>}
        </NextStepBar>
      )}
      <header className="flex flex-col gap-3">
        <PageTitle>{`#${ticket.number} Run ${run.id}`}</PageTitle>
        <h1 className="title">#{ticket.number} {ticket.title}</h1>
        <RunStatusLine health={health} status={run.status} stage={run.stage} runId={run.id} showSentence={!action} />
        {run.preemptedFor && (run.preemptAt || run.reasonKind === 'preempted') && <p className="body" role="status">Preempted by #{run.preemptedFor}</p>}
        {forgeLink && <div><ForgeLink {...forgeLink} /></div>}
        {notice === 'active' && <p className="body" role="status">A Run is already active for this stage</p>}
        {notice === 'healthy' && <p className="body" role="status">Not released: the session still reports in.</p>}
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6 max-sm:flex max-sm:flex-col">
        <div className="flex min-w-0 flex-col gap-6 max-sm:contents">
          {ci && run.status === 'running' && ci.summary.rows.length > 0 && <div className={ORDER.ci}><CiPanel summary={ci.summary} /></div>}
          <RunTimeline run={run} steps={steps} total={stepsTotal} calls={adminData?.callsByStep ?? new Map()} state={health.state} now={now} admin={admin} bars={admin && bars === '1'} className={ORDER.timeline} />
          {(run.verdict || run.evidence || run.error) && (
            <section aria-labelledby="run-proof" className={`flex min-w-0 flex-col gap-4 ${ORDER.proof}`}>
              <h2 id="run-proof" className="heading">Proof</h2>
              {run.verdict && (
                <Card asChild className="gap-4">
                  <section aria-label="Review">
                    <h3 className="label text-muted-foreground">Review verdict <Badge variant={run.verdict === 'clean' ? 'ok' : 'warn'}>{run.verdict === 'clean' ? 'Clean' : 'Changes requested'}</Badge></h3>
                    {run.findings?.length ? (
                      <ul className="m-0 flex list-none flex-col gap-4 p-0" aria-label="Findings">
                        {run.findings.map((f, i) => (
                          <li key={i} className="small">
                            <Badge variant={f.severity === 'low' ? 'neutral' : 'destructive'}>{f.severity}</Badge> <span className="mono break-all">{f.file}:{f.line}</span> {f.msg}
                            <div className="text-muted-foreground">Scenario: {f.scenario}</div>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="small text-muted-foreground">No findings.</p>}
                  </section>
                </Card>
              )}
              {run.evidence && (
                <div className="min-w-0 max-w-full overflow-x-auto">
                  <h3 className="label text-muted-foreground">Evidence</h3>
                  <Markdown className="small" html={renderMarkdown(run.evidence)} />
                </div>
              )}
              {run.error && <p className="m-0 break-words text-destructive">{run.error}</p>}
            </section>
          )}
          {admin && Array.isArray(run.goal) && run.goal.length > 0 && (
            <section aria-labelledby="run-goal" className={`flex flex-col gap-2 ${ORDER.goal}`}>
              <h2 id="run-goal" className="heading">Goal</h2>
              <ul className="small m-0 list-disc pl-4">{run.goal.map((g, i) => <li key={i}>{g}</li>)}</ul>
            </section>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-4 max-sm:contents lg:sticky lg:top-[calc(var(--next-step-h,0px)+var(--space-4))]">
          <RunLinks links={runLinks({ forge, prUrl: run.artifacts?.prUrl ?? ci?.summary.url, ciUrl: ci?.summary.url, issueUrl: ticket.url, ticket })} className={ORDER.links}>
            {admin && kindOfRun(wf, run) === 'build' && <RelinkMr run={run.id} />}
          </RunLinks>
          <RunAgent run={run} session={session} role={role && { title: role.title, avatar: role.avatar ?? role.id }} admin={adminData} animate={health.state === 'working'} className={ORDER.agent} />
          <RunRelations chain={chain} className={ORDER.relations} />
          <RunTimes run={run} lastReportAt={steps.at(-1)?.at ?? null} now={now} className={ORDER.times} />
        </div>
      </div>
    </>
  )
}
