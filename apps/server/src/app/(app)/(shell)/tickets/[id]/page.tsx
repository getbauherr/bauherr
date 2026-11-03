import { APPROVED_PLAN } from '@bauherr/adapters'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sourceOf } from '../../../../../lib/actions'
import { ActionBar } from '../../../components/ActionBar'
import { OwnerChat } from '../../../components/OwnerChat'
import { DecisionSheet } from '../../../components/DecisionSheet'
import { Approved, Gate, ProductionChecksGate, ProductionGate, QuestionsGate, ReleaseGate, RerunGate, ReviewCapGate } from '../../../components/Gate'
import { StagePipeline } from '../../../components/StagePipeline'
import { StatusChip } from '../../../components/StatusChip'
import { hasProductionChecks } from '../../../../../lib/mode'
import { SUMMARY_MARKER } from '../../../../../lib/summary'
import { renderMarkdown } from '../../../lib/markdown'
import { GATES } from '../../../lib/gates'
import { needsYou, reviewWord, stageOf } from '../../../lib/needs-you'
import { PLAN_MARKER, WORKLOG_MARKER, firstWith, latestWith, parseAnswers, parseDecisions, planSummary, answersOf, sheetOf, unansweredCritical, withoutDecisions, withoutWorklogHeading } from '../../../lib/plan'
import { ago } from '../../../lib/format'
import { isAdmin } from '../../../lib/settings'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { isWebUrl } from '../../../lib/url'
import { waitingLabel } from '../../../../../lib/wip'
import '../../../ticket.css'

export const dynamic = 'force-dynamic'

type Doc = Record<string, any>

const duration = (r: Doc) => {
  if (!r.startedAt || !r.finishedAt) return '—'
  const s = Math.max(0, Math.round((+new Date(r.finishedAt) - +new Date(r.startedAt)) / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}
const excerpt = (md: unknown) => (typeof md === 'string' ? md.replace(/[#*`>|-]/g, '').trim().split('\n')[0]!.slice(0, 120) : '')
const strip = (body: string, marker: string) => body.slice(marker.length).trim()

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user, workspace } = await currentWorkspace()
  const admin = isAdmin(user)
  if (!workspace || !/^\d+$/.test(id)) notFound()
  const payload = await payloadClient()
  const q = { depth: 0, overrideAccess: true } as const
  const [ticket] = (await payload.find({ collection: 'tickets', where: { and: [{ id: { equals: id } }, { workspace: { equals: workspace.id } }] }, limit: 1, ...q })).docs as Doc[]
  if (!ticket) notFound()
  const [product, ws, runs, blockers, blocks, shots] = await Promise.all([
    payload.findByID({ collection: 'products', id: ticket.product, ...q }) as Promise<Doc>,
    payload.findByID({ collection: 'workspaces', id: workspace.id, ...q }) as Promise<Doc>,
    payload.find({ collection: 'runs', where: { ticket: { equals: ticket.id } }, sort: '-createdAt', pagination: false, ...(admin ? {} : { select: { stage: true, status: true, startedAt: true, evidence: true, createdAt: true } }), ...q }).then((r) => r.docs as Doc[]),
    ticket.blockedBy?.length ? payload.find({ collection: 'tickets', where: { and: [{ id: { in: ticket.blockedBy } }, { workspace: { equals: workspace.id } }] }, pagination: false, ...q }).then((r) => r.docs as Doc[]) : [],
    payload.find({ collection: 'tickets', where: { and: [{ blockedBy: { equals: ticket.id } }, { workspace: { equals: workspace.id } }] }, pagination: false, ...q }).then((r) => r.docs as Doc[]),
    payload.find({ collection: 'media', where: { and: [{ 'session.product': { equals: ticket.product } }, { 'session.ticketNumber': { equals: ticket.number } }, { 'session.status': { equals: 'submitted' } }] }, select: { name: true }, sort: 'id', pagination: false, ...q }).then((r) => r.docs as Doc[]),
  ])

  let comments: { body: string }[] = []
  let labels: string[] = ticket.labels ?? []
  let forgeError = false
  try {
    const { ts, n } = await sourceOf(payload, ticket)
    ;[comments, labels] = await Promise.all([ts.listComments(n), ts.get(n).then((t) => t.labels)])
  } catch {
    forgeError = true
  }
  const plan = latestWith(comments, PLAN_MARKER)?.body
  const worklog = firstWith(comments, WORKLOG_MARKER)?.body
  const sheet = sheetOf(comments)?.body
  const decisions = sheet ? parseDecisions(sheet) : []
  const answers = parseAnswers(answersOf(comments)?.body ?? '')
  const missing = unansweredCritical(decisions, answers)
  const todo = needsYou({ stage: ticket.stage, labels, releaseState: ticket.releaseState, productionState: ticket.productionState, productionChecksMissing: !hasProductionChecks(product), releaseChecksState: ticket.releaseChecksState, reviewState: ticket.reviewState, reviewRounds: ticket.reviewRounds }, (runs[0] as { stage: string; status: string } | undefined) ?? null, missing.length)
  const approved = labels.includes(APPROVED_PLAN)
  const waiting = ticket.state === 'open' ? await waitingLabel(payload, ticket) : null
  const summary = plan ? planSummary(plan) : null
  const gate = todo ? GATES[todo] : null
  const capFindings = latestWith(comments, 'Bauherr needs a human:')?.body
  const stagingSummary = latestWith(comments, SUMMARY_MARKER)?.body
  const acceptedStaging = labels.includes('bauherr:approved:staging')
  const waitingForStaging = ticket.stage === 'release' && !acceptedStaging && !gate
  const answered = decisions.filter((d) => answers[d.id]).length
  const live = runs[0] && ['running', 'awaiting_session'].includes(runs[0].status) ? runs[0] : null
  const idle = `Nothing to do: ${
    live ? `${live.stage} is running (Run #${live.id}${admin ? `, ${live.mode === 'session' ? 'session' : 'scheduler'}` : ''})`
    : waitingForStaging ? `waiting for the staging deploy of ${ticket.mergeSha?.slice(0, 7) ?? 'the merge commit'}`
    : ticket.stage === 'review' ? reviewWord(ticket.reviewState).replace(/^./, (c) => c.toLowerCase())
    : stageOf(ticket)}.`
  const tiers = Object.entries((ws.modelByTier as Record<string, string> | null) ?? {})

  return (
    <div className="stack">
      <ActionBar ticket={ticket.id} need={todo} stage={runs[0]?.stage ?? stageOf(ticket)} missing={missing.map((d) => d.id)} open={decisions.length - answered} run={runs[0]?.id ?? null} idle={idle} releaseRunUrl={ticket.releaseRunUrl} />
      <h1 className="title">#{ticket.number} {ticket.title}</h1>
      <p className="meta small muted">
        <span>{product.name}</span>
        {isWebUrl(ticket.url) && <a className="link" href={ticket.url}>Open on the forge</a>}
      </p>
      <StagePipeline current={stageOf(ticket)} />
      {waiting && <p className="small chip waiting" role="status">{waiting}</p>}
      {(blockers.length > 0 || blocks.length > 0) && (
        <ul className="deps small" aria-label="Dependencies">
          {blockers.map((b) => <li key={b.id}>Blocked by <Link className="link" href={`/tickets/${b.id}`}>#{b.number} {b.title}</Link> <span className="muted">({b.state === 'closed' ? 'closed' : 'open'})</span></li>)}
          {blocks.length > 0 && <li>Blocks {blocks.map((b, i) => <span key={b.id}>{i > 0 && ', '}<Link className="link" href={`/tickets/${b.id}`}>#{b.number}</Link></span>)}</li>}
        </ul>
      )}
      {forgeError && <p className="small muted">The forge could not be reached; plan and worklog are unavailable.</p>}

      {summary && approved && <Approved number={ticket.number} />}
      {gate?.kind === 'plan' && (
        <Gate
          number={ticket.number}
          plan={summary ?? null}
          budget={!admin ? undefined : ws.budgetUnit === 'tokens' ? `${ws.budgetTokens30d?.toLocaleString('en')} tokens / 30 days` : `$${ws.budgetUsd30d} / 30 days`}
          model={admin ? tiers.map(([tier, m]) => `${tier}: ${m}`).join(' · ') || '—' : undefined}
          sheet={decisions.length ? `${answered} of ${decisions.length} answered · ${missing.length} critical open` : 'none'}
        />
      )}
      {gate?.kind === 'questions' && <QuestionsGate number={ticket.number} answered={answered} total={decisions.length} />}
      {gate?.kind === 'release' && (
        <ReleaseGate ticket={ticket.id} number={ticket.number} title={gate.title} timedOut={todo === 'Staging not confirmed'} summaryHtml={stagingSummary ? renderMarkdown(strip(stagingSummary, SUMMARY_MARKER)) : null} stagingUrl={product.stagingUrl ?? null} />
      )}
      {gate?.kind === 'production-checks' && <ProductionChecksGate number={ticket.number} title={gate.title} />}
      {gate?.kind === 'production' && <ProductionGate number={ticket.number} title={gate.title} failed={todo === 'Production deploy failed'} />}
      {gate?.kind === 'review-cap' && (
        <ReviewCapGate number={ticket.number} title={gate.title} findingsHtml={capFindings ? renderMarkdown(capFindings) : null} />
      )}
      {gate?.kind === 'rerun' && runs[0] && <RerunGate run={runs[0].id} number={ticket.number} title={gate.title} stage={runs[0].stage} />}
      {acceptedStaging && <Approved number={ticket.number} label="Accepted on staging" />}
      {labels.includes('bauherr:approved:production') && <Approved number={ticket.number} label="Approved for production" />}
      {decisions.some((d) => !answers[d.id]) && <OwnerChat ticket={ticket.id} />}
      {decisions.length > 0 && <DecisionSheet ticket={ticket.id} decisions={decisions} answers={answers} />}

      {plan && (
        <section className="stack" aria-labelledby="plan">
          <h2 className="heading" id="plan">Plan</h2>
          <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(withoutDecisions(strip(plan, PLAN_MARKER))) }} />
        </section>
      )}
      {worklog && (
        <section className="stack" aria-labelledby="worklog">
          <h2 className="heading" id="worklog">Worklog</h2>
          <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(withoutWorklogHeading(strip(worklog, WORKLOG_MARKER))) }} />
        </section>
      )}

      {shots.length > 0 && (
        <section className="stack" aria-labelledby="attachments">
          <h2 className="heading" id="attachments">Attachments</h2>
          <ul className="shots">
            {shots.map((m) => <li key={m.id}><a href={`/intake/api/media/${m.id}`} target="_blank" rel="noreferrer"><img src={`/intake/api/media/${m.id}`} alt={m.name} loading="lazy" /></a></li>)}
          </ul>
        </section>
      )}

      <section className="stack" aria-labelledby="runs">
        <h2 className="heading" id="runs">Runs</h2>
        {runs.length ? (
          <div className="scroll">
            <table className="table">
              <thead>
                <tr className="label">{['Run', 'Stage', 'Status', ...(admin ? ['Mode', 'Duration', 'Cost'] : ['When']), 'Evidence'].map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="mono"><Link className="link" href={`/runs/${r.id}`}>#{r.id}</Link></td>
                    <td>{r.stage}</td>
                    <td><StatusChip status={r.status} /></td>
                    {admin ? (
                      <>
                        <td>{r.mode}</td>
                        <td className="mono">{duration(r)}</td>
                        <td className="mono">{r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : '—'}</td>
                      </>
                    ) : (
                      <td className="muted">{ago(r.createdAt)}</td>
                    )}
                    <td className="small muted excerpt" title={excerpt(r.evidence)}>{excerpt(r.evidence) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No Runs yet.</p>
        )}
      </section>
    </div>
  )
}
