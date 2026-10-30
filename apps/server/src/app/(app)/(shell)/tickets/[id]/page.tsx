import { APPROVED_PLAN } from '@bauherr/adapters'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { sourceOf } from '../../../../../lib/actions'
import { DecisionSheet } from '../../../components/DecisionSheet'
import { Approved, Gate } from '../../../components/Gate'
import { StagePipeline } from '../../../components/StagePipeline'
import { StatusChip } from '../../../components/StatusChip'
import { renderMarkdown } from '../../../lib/markdown'
import { needsYou, stageOf } from '../../../lib/needs-you'
import { DECISIONS_MARKER, PLAN_MARKER, WORKLOG_MARKER, latestWith, parseAnswers, parseDecisions, planSummary, unansweredCritical } from '../../../lib/plan'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { isWebUrl } from '../../../lib/url'
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
  const { workspace } = await currentWorkspace()
  if (!workspace || !/^\d+$/.test(id)) notFound()
  const payload = await payloadClient()
  const q = { depth: 0, overrideAccess: true } as const
  const [ticket] = (await payload.find({ collection: 'tickets', where: { and: [{ id: { equals: id } }, { workspace: { equals: workspace.id } }] }, limit: 1, ...q })).docs as Doc[]
  if (!ticket) notFound()
  const [product, ws, runs] = await Promise.all([
    payload.findByID({ collection: 'products', id: ticket.product, ...q }) as Promise<Doc>,
    payload.findByID({ collection: 'workspaces', id: workspace.id, ...q }) as Promise<Doc>,
    payload.find({ collection: 'runs', where: { ticket: { equals: ticket.id } }, sort: '-createdAt', pagination: false, ...q }).then((r) => r.docs as Doc[]),
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
  const worklog = latestWith(comments, WORKLOG_MARKER)?.body
  const decisions = plan ? parseDecisions(plan) : []
  const answers = parseAnswers(latestWith(comments, DECISIONS_MARKER)?.body ?? '')
  const missing = unansweredCritical(decisions, answers)
  const todo = needsYou({ stage: ticket.stage, labels }, (runs[0] as { stage: string; status: string } | undefined) ?? null, missing.length)
  const approved = labels.includes(APPROVED_PLAN)
  const summary = plan ? planSummary(plan) : null
  const tiers = Object.entries((ws.modelByTier as Record<string, string> | null) ?? {})

  return (
    <div className="stack">
      <h1 className="title">#{ticket.number} {ticket.title}</h1>
      <p className="meta small muted">
        <span>{product.name}</span>
        {isWebUrl(ticket.url) && <a className="link" href={ticket.url}>Open on the forge</a>}
      </p>
      <StagePipeline current={stageOf(ticket)} />
      {forgeError && <p className="small muted">The forge could not be reached; plan and worklog are unavailable.</p>}

      {summary && approved && <Approved number={ticket.number} />}
      {summary && todo && (todo === 'Approve plan' || todo === 'Answer decisions') && (
        <Gate
          ticket={ticket.id}
          number={ticket.number}
          plan={summary}
          budget={ws.budgetUnit === 'tokens' ? `${ws.budgetTokens30d?.toLocaleString('en')} tokens / 30 days` : `$${ws.budgetUsd30d} / 30 days`}
          model={tiers.map(([tier, m]) => `${tier}: ${m}`).join(' · ') || '—'}
          sheet={decisions.length ? `${decisions.length - missing.length} of ${decisions.length} answered · ${missing.length} critical open` : 'none'}
          blocked={missing.length ? `Answer ${missing.map((d) => d.id).join(', ')} first (critical).` : null}
        />
      )}
      {decisions.length > 0 && <DecisionSheet ticket={ticket.id} decisions={decisions} answers={answers} />}

      {plan && (
        <section className="stack" aria-labelledby="plan">
          <h2 className="heading" id="plan">Plan</h2>
          <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(strip(plan, PLAN_MARKER)) }} />
        </section>
      )}
      {worklog && (
        <section className="stack" aria-labelledby="worklog">
          <h2 className="heading" id="worklog">Worklog</h2>
          <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(strip(worklog, WORKLOG_MARKER)) }} />
        </section>
      )}

      <section className="stack" aria-labelledby="runs">
        <h2 className="heading" id="runs">Runs</h2>
        {runs.length ? (
          <div className="scroll">
            <table className="table">
              <thead>
                <tr className="label">{['Run', 'Stage', 'Status', 'Mode', 'Duration', 'Cost', 'Evidence'].map((h) => <th key={h}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="mono"><Link className="link" href={`/runs/${r.id}`}>#{r.id}</Link></td>
                    <td>{r.stage}</td>
                    <td><StatusChip status={r.status} /></td>
                    <td>{r.mode}</td>
                    <td className="mono">{duration(r)}</td>
                    <td className="mono">{r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : '—'}</td>
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
