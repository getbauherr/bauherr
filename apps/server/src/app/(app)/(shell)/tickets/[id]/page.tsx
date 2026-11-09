import { APPROVED_PLAN } from '@bauherr/adapters'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sourceOf } from '../../../../../lib/actions'
import { mediaLimits } from '../../../../../lib/intake/media'
import { FixState } from '../../../components/FixState'
import { EpicChildren, EpicProgress } from '../../../components/Epics'
import { ActionBar } from '../../../components/ActionBar'
import { CommentComposer } from '../../../components/CommentComposer'
import { OwnerChat } from '../../../components/OwnerChat'
import { Gate, ReleaseGate } from '../../../components/Gate'
import { Markdown } from '../../../components/Markdown'
import { StageHistory } from '../../../components/StageHistory'
import { StagePipeline } from '../../../components/StagePipeline'
import { StatusChip } from '../../../components/StatusChip'
import { TicketDetails } from '../../../components/TicketDetails'
import { Table } from '../../../components/ui/table'
import { hasProductionChecks } from '../../../../../lib/mode'
import { SUMMARY_MARKER } from '../../../../../lib/summary'
import { FORGE_TIMEOUT_MS, loadOverviewRows, within } from '../../../lib/overview'
import { renderMarkdown } from '../../../lib/markdown'
import { GATES } from '../../../lib/gates'
import { nextStep } from '../../../../../lib/next-step'
import { needsYou, reviewWord, stageOf } from '../../../lib/needs-you'
import { ESCALATION_MARKER, INVESTIGATION_MARKER, PLAN_MARKER, WORKLOG_MARKER, firstWith, latestWith, parseAnswers, parseDecisions, planSummary, answersOf, sheetOf, unansweredCritical, withoutDecisions, withoutWorklogHeading } from '../../../lib/plan'
import { ago } from '../../../lib/format'
import { checkLines, reachedStages, stageHistory } from '../../../lib/stage-history'
import { isAdmin } from '../../../lib/settings'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { isWebUrl } from '../../../lib/url'
import { latestChecks, prOf } from '../../../../../lib/release'
import { waitingLabel } from '../../../../../lib/wip'

export const dynamic = 'force-dynamic'

type Doc = Record<string, any>

const duration = (r: Doc) => {
  if (!r.startedAt || !r.finishedAt) return '—'
  const s = Math.max(0, Math.round((+new Date(r.finishedAt) - +new Date(r.startedAt)) / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}
const excerpt = (md: unknown) => (typeof md === 'string' ? md.replace(/[#*`>|-]/g, '').trim().split('\n')[0]!.slice(0, 120) : '')
const strip = (body: string, marker: string) => body.slice(marker.length).trim()

export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ stage?: string }> }) {
  const { id } = await params
  const { stage: stageParam } = await searchParams
  const { user, workspace } = await currentWorkspace()
  const admin = isAdmin(user)
  if (!workspace || !/^\d+$/.test(id)) notFound()
  const payload = await payloadClient()
  const q = { depth: 0, overrideAccess: true } as const
  const [ticket] = (await payload.find({ collection: 'tickets', where: { and: [{ id: { equals: id } }, { workspace: { equals: workspace.id } }] }, limit: 1, ...q })).docs as Doc[]
  if (!ticket) notFound()
  const forge = (async () => {
    try {
      const { ts, n } = await sourceOf(payload, ticket)
      const [comments, t] = await within(Promise.all([ts.listComments(n), ts.get(n)]), FORGE_TIMEOUT_MS)
      return { comments: comments as { body: string }[], labels: t.labels, forgeError: false }
    } catch {
      return { comments: [] as { body: string }[], labels: ticket.labels ?? ([] as string[]), forgeError: true }
    }
  })()
  const [product, ws, runs, blockers, blocks, shots] = await Promise.all([
    payload.findByID({ collection: 'products', id: ticket.product, ...q }) as Promise<Doc>,
    payload.findByID({ collection: 'workspaces', id: workspace.id, ...q }) as Promise<Doc>,
    payload.find({ collection: 'runs', where: { ticket: { equals: ticket.id } }, sort: '-createdAt', pagination: false, ...(admin ? {} : { select: { stage: true, status: true, startedAt: true, evidence: true, createdAt: true, error: true, verdict: true, findings: true, reviewedSha: true } }), ...q }).then((r) => r.docs as Doc[]),
    ticket.blockedBy?.length ? payload.find({ collection: 'tickets', where: { and: [{ id: { in: ticket.blockedBy } }, { workspace: { equals: workspace.id } }] }, pagination: false, ...q }).then((r) => r.docs as Doc[]) : [],
    payload.find({ collection: 'tickets', where: { and: [{ blockedBy: { equals: ticket.id } }, { workspace: { equals: workspace.id } }] }, pagination: false, ...q }).then((r) => r.docs as Doc[]),
    payload.find({ collection: 'media', where: { and: [{ 'session.product': { equals: ticket.product } }, { 'session.ticketNumber': { equals: ticket.number } }, { 'session.status': { equals: 'submitted' } }] }, select: { name: true }, sort: 'id', pagination: false, ...q }).then((r) => r.docs as Doc[]),
  ])

  const [{ comments, labels, forgeError }, overview] = await Promise.all([forge, loadOverviewRows(workspace.id, false)])
  const epic = overview.epics.find((e) => e.id === ticket.id)
  const plan = latestWith(comments, PLAN_MARKER)?.body
  const worklog = firstWith(comments, WORKLOG_MARKER)?.body
  const investigation = latestWith(comments, INVESTIGATION_MARKER)?.body
  const escalations = latestWith(comments, ESCALATION_MARKER)?.body
  const sheet = sheetOf(comments)?.body
  const decisions = sheet ? parseDecisions(sheet) : []
  const answers = parseAnswers(answersOf(comments)?.body ?? '')
  const missing = unansweredCritical(decisions, answers)
  const todo = needsYou({ stage: ticket.stage, labels, releaseState: ticket.releaseState, productionState: ticket.productionState, productionChecksMissing: !hasProductionChecks(product), releaseChecksState: ticket.releaseChecksState, reviewState: ticket.reviewState, reviewRounds: ticket.reviewRounds, expedite: ticket.expedite }, (runs[0] as { stage: string; status: string; reasonKind?: string | null } | undefined) ?? null, missing.length)
  const approved = labels.includes(APPROVED_PLAN)
  const waiting = ticket.state === 'open' && !blockers.some((b) => b.state !== 'closed') ? await waitingLabel(payload, ticket) : null
  const summary = plan ? planSummary(plan) : null
  const gate = todo ? GATES[todo] : null
  const capFindings = latestWith(comments, 'Bauherr needs a human:')?.body
  const reason = (todo === 'Needs you' ? capFindings?.replace(/^Bauherr needs a human:\s*/, '').split('\n')[0] : ['Cancelled', 'Run failed', 'Run needs you'].includes(todo ?? '') ? runs[0]?.error : null)?.slice(0, 300) ?? null
  const stagingSummary = latestWith(comments, SUMMARY_MARKER)?.body
  const acceptedStaging = labels.includes('bauherr:approved:staging')
  const answered = decisions.filter((d) => answers[d.id]).length
  const holderNumbers = /^overlaps #(\d+)$/.exec(ticket.waitingReason ?? '')?.[1]
  const holders = holderNumbers ? await payload.find({ collection: 'tickets', where: { and: [{ number: { equals: Number(holderNumbers) } }, { product: { equals: ticket.product } }] }, select: { number: true }, pagination: false, ...q }).then((r) => (r.docs as Doc[]).map((d) => ({ id: d.id as number, number: d.number as number }))) : []
  const idle = nextStep({ ticket: { ...ticket, labels }, need: todo, run: (runs[0] as { id: number; stage: string; status: string; escalation?: { step: number; reason: string } | null } | undefined) ?? null, waiting, blockers: blockers.filter((b) => b.state !== 'closed').map((b) => ({ id: b.id, number: b.number })), holders, admin })
  const decisionsOpen = decisions.length - answered > 0 && !approved
  const history = [summary && approved && 'Plan approved', acceptedStaging && 'Accepted on staging', labels.includes('bauherr:approved:production') && 'Approved for production'].filter(Boolean).join(' · ')
  const reached = reachedStages({ state: ticket.state, stage: stageOf(ticket) }, runs as { stage: string }[])
  const selected = reached.find((s) => s === stageParam)
  let mr: { url: string; headSha: string | null; checks: ReturnType<typeof checkLines> } | null = null
  if (selected === 'build') {
    try {
      const found = await prOf(payload, ticket)
      if (found) mr = { url: found.pr.url, headSha: found.pr.headSha, checks: checkLines(latestChecks(await found.backend.forge.listChecks(found.repo, found.pr.headSha))) }
    } catch {
      mr = null
    }
  }
  const stageData = selected && stageHistory(selected, { runs, plan: plan ? withoutDecisions(strip(plan, PLAN_MARKER)) : null, decisions, answers, mr, stagingSummary: stagingSummary ? strip(stagingSummary, SUMMARY_MARKER) : null, accepted: acceptedStaging, production: ticket.productionState ?? null })
  const tiers = Object.entries((ws.modelByTier as Record<string, string> | null) ?? {})

  return (
    <div className="flex flex-col gap-4">
      <ActionBar ticket={ticket.id} product={product.id as number} need={todo} stage={runs[0]?.stage ?? stageOf(ticket)} missing={missing.map((d) => d.id)} open={decisions.length - answered} run={runs[0]?.id ?? null} reason={reason} idle={idle} releaseRunUrl={ticket.releaseRunUrl} stagingUrl={product.stagingUrl} canExpedite={admin && ticket.state === 'open' && !ticket.expedite && ws.expediteLane !== false && !['release', 'parent'].includes(stageOf(ticket))} />
      <h1 className="title">#{ticket.number} {ticket.title}</h1>
      <p className="small text-muted-foreground">{product.name}</p>
      {epic ? (
        <section className="flex flex-col gap-4" aria-labelledby="subtickets">
          <h2 className="heading" id="subtickets">Sub-tickets</h2>
          <EpicProgress epic={epic} />
          <EpicChildren epic={epic} />
        </section>
      ) : <StagePipeline current={stageOf(ticket)} reached={reached} selected={selected} />}
      {stageData && !epic && <StageHistory data={stageData} admin={admin} />}
      {history && <p className="small text-muted-foreground">{history}</p>}
      {forgeError && <p className="small text-muted-foreground">The forge could not be reached; plan and worklog are unavailable.</p>}

      {gate?.kind === 'plan' && <Gate plan={summary ?? null} />}
      {gate?.kind === 'release' && <ReleaseGate ticket={ticket.id} timedOut={todo === 'Staging not confirmed'} summaryHtml={stagingSummary ? renderMarkdown(strip(stagingSummary, SUMMARY_MARKER)) : null} />}
      {decisionsOpen && <OwnerChat ticket={ticket.id} open={decisions.length - answered} />}

      <TicketDetails key={ticket.id}>
        <dl className="body m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:break-words [&_dt]:text-muted-foreground">
          {isWebUrl(ticket.url) && <><dt>Forge</dt><dd><a className="text-primary" href={ticket.url}>Open on the forge</a></dd></>}
          {admin && <><dt>Budget</dt><dd className="mono">{ws.budgetUnit === 'tokens' ? `${ws.budgetTokens30d?.toLocaleString('en')} tokens / 30 days` : `$${ws.budgetUsd30d} / 30 days`}</dd></>}
          {admin && <><dt>Model</dt><dd className="mono">{tiers.map(([tier, m]) => `${tier}: ${m}`).join(' · ') || '—'}</dd></>}
          {admin && ticket.mergeSha && <><dt>Merge commit</dt><dd className="mono">{ticket.mergeSha}</dd></>}
          {decisions.length > 0 && <><dt>Decisions</dt><dd>{approved ? `${answered} answered` : `${answered} of ${decisions.length} answered · ${missing.length} critical open`}</dd></>}
        </dl>
        {(blockers.length > 0 || blocks.length > 0) && (
          <ul className="small m-0 flex list-none flex-col gap-1 p-0" aria-label="Dependencies">
            {blockers.map((b) => <li key={b.id}>Blocked by <Link className="text-primary" href={`/tickets/${b.id}`}>#{b.number} {b.title}</Link> <span className="text-muted-foreground">({b.state === 'closed' ? 'closed' : 'open'})</span></li>)}
            {blocks.length > 0 && <li>Blocks {blocks.map((b, i) => <span key={b.id}>{i > 0 && ', '}<Link className="text-primary" href={`/tickets/${b.id}`}>#{b.number}</Link></span>)}</li>}
          </ul>
        )}
        {capFindings && gate?.kind === 'review-cap' && <Markdown html={renderMarkdown(capFindings)} />}
        {plan && (
          <section className="flex flex-col gap-4" aria-labelledby="plan">
            <h2 className="heading" id="plan">Plan</h2>
            <Markdown html={renderMarkdown(withoutDecisions(strip(plan, PLAN_MARKER)))} />
          </section>
        )}
        {escalations && (
          <section className="flex flex-col gap-4" aria-labelledby="escalations">
            <h2 className="heading" id="escalations">Escalations</h2>
            <Markdown html={renderMarkdown(strip(escalations, ESCALATION_MARKER))} />
          </section>
        )}
        {investigation && (
          <section className="flex flex-col gap-4" aria-labelledby="investigation">
            <h2 className="heading" id="investigation">Investigation</h2>
            <Markdown html={renderMarkdown(strip(investigation, INVESTIGATION_MARKER))} />
          </section>
        )}
        {worklog && (
          <section className="flex flex-col gap-4" aria-labelledby="worklog">
            <h2 className="heading" id="worklog">Worklog</h2>
            <Markdown html={renderMarkdown(withoutWorklogHeading(strip(worklog, WORKLOG_MARKER)))} />
          </section>
        )}
        {shots.length > 0 && (
          <section className="flex flex-col gap-4" aria-labelledby="attachments">
            <h2 className="heading" id="attachments">Attachments</h2>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {shots.map((m) => <li key={m.id}><a href={`/intake/api/media/${m.id}`} target="_blank" rel="noreferrer"><img className="block h-24 w-auto max-w-[200px] rounded-sm border border-border object-cover" src={`/intake/api/media/${m.id}`} alt={m.name} loading="lazy" /></a></li>)}
            </ul>
          </section>
        )}
        <section className="flex flex-col gap-4" aria-labelledby="runs">
          <h2 className="heading" id="runs">Runs</h2>
          {runs.length ? (
            <Table>
              <thead>
                <tr className="label">{(admin ? ['Run', 'Stage', 'Status', 'Duration', 'Evidence'] : ['Stage', 'Status', 'When', 'Evidence']).map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    {admin ? (
                      <>
                        <td className="mono"><Link className="text-primary" href={`/runs/${r.id}`}>#{r.id}</Link></td>
                        <td>{r.stage}</td>
                      </>
                    ) : (
                      <td><Link className="text-primary" href={`/runs/${r.id}`}>{r.stage}</Link></td>
                    )}
                    <td><StatusChip status={r.status} /></td>
                    {admin ? <td className="mono">{duration(r)}</td> : <td className="text-muted-foreground">{ago(r.createdAt)}</td>}
                    <td className="small max-w-[32ch] truncate text-muted-foreground" title={excerpt(r.evidence)}>{excerpt(r.evidence) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-muted-foreground">No Runs yet.</p>
          )}
        </section>
        {admin && <FixState ticket={ticket.id} stage={ticket.stage ?? 'triage'} />}
      </TicketDetails>

      {!forgeError && <CommentComposer ticket={ticket.id} maxBytes={mediaLimits().maxBytes} maxImages={mediaLimits().maxPerSession} />}
    </div>
  )
}
