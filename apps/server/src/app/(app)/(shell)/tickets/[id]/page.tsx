import { PageTitle } from '../../../components/PageTitle'
import { APPROVED_PLAN } from '@bauherr/adapters'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { sourceOf } from '../../../../../lib/actions'
import { mediaLimits } from '../../../../../lib/intake/media'
import { FixState } from '../../../components/FixState'
import { EpicChildren, EpicProgress } from '../../../components/Epics'
import { ActionBar } from '../../../components/ActionBar'
import { CommentComposer } from '../../../components/CommentComposer'
import { OwnerChat } from '../../../components/OwnerChat'
import { DecisionCard } from '../../../components/DecisionCard'
import { ReleaseGate } from '../../../components/Gate'
import { Markdown } from '../../../components/Markdown'
import { TicketSteps } from '../../../components/workflow/TicketSteps'
import { WorkflowGraph } from '../../../components/workflow/WorkflowGraph'
import { StatusChip } from '../../../components/StatusChip'
import { TicketDetails } from '../../../components/TicketDetails'
import { Table } from '../../../components/ui/table'
import { hasProductionChecks } from '../../../../../lib/mode'
import { SUMMARY_MARKER } from '../../../../../lib/summary'
import { cardOf } from '../../../lib/inbox'
import { forgeKinds, loadEpic, within } from '../../../lib/overview'
import { buildSteps } from '../../../lib/steps'
import { timeline } from '../../../../../lib/history'
import { renderMarkdown } from '../../../lib/markdown'
import { GATES } from '../../../lib/gates'
import { nextStep } from '../../../../../lib/next-step'
import { needsYou, reviewWord, stageOf } from '../../../lib/needs-you'
import { DEFAULT, is, nameOf } from '../../../../../lib/workflow'
import { ESCALATION_MARKER, INVESTIGATION_MARKER, PLAN_MARKER, WORKLOG_MARKER, firstWith, latestWith, parseAnswers, parseDecisions, planSummary, answersOf, sheetOf, unansweredCritical, withoutDecisions, withoutWorklogHeading } from '../../../lib/plan'
import { ago } from '../../../lib/format'
import { isAdmin } from '../../../lib/settings'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { isWebUrl } from '../../../lib/url'
import { waitingLabel } from '../../../../../lib/wip'

export const dynamic = 'force-dynamic'

/** The forge-backed part of the page (live labels, comments, MR checks) is streamed; past this it shows what the database has and says so. */
const LIVE_MS = 5000

type Doc = Record<string, any>

const duration = (r: Doc) => {
  if (!r.startedAt || !r.finishedAt) return '—'
  const s = Math.max(0, Math.round((+new Date(r.finishedAt) - +new Date(r.startedAt)) / 1000))
  return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}
const excerpt = (md: unknown) => (typeof md === 'string' ? md.replace(/[#*`>|-]/g, '').trim().split('\n')[0]!.slice(0, 120) : '')
const strip = (body: string, marker: string) => body.slice(marker.length).trim()

const Pulse = ({ h }: { h: string }) => <div className={`${h} animate-pulse rounded-sm bg-secondary`} aria-hidden />

/** DB data of the page, passed to the streamed parts. */
type Page = { ticket: Doc; product: Doc; ws: Doc; runs: Doc[]; blockers: Doc[]; blocks: Doc[]; shots: Doc[]; admin: boolean }

/** Everything derived from the forge comments and labels of the Ticket. */
async function derive(payload: Awaited<ReturnType<typeof payloadClient>>, P: Page) {
  const { ticket, product, runs, blockers, admin } = P
  const wf = DEFAULT()
  const live = await within(
    (async () => {
      const { ts, n } = await sourceOf(payload, ticket)
      const [comments, t] = await Promise.all([ts.listComments(n), ts.get(n)])
      return { comments: comments as { body: string }[], labels: t.labels, forgeError: false }
    })(),
    LIVE_MS,
  ).catch(() => ({ comments: [] as { body: string }[], labels: ticket.labels ?? ([] as string[]), forgeError: true }))
  const { comments, labels, forgeError } = live
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
  const q = { depth: 0, overrideAccess: true } as const
  const holders = holderNumbers ? await payload.find({ collection: 'tickets', where: { and: [{ number: { equals: Number(holderNumbers) } }, { product: { equals: ticket.product } }] }, select: { number: true }, pagination: false, ...q }).then((r) => (r.docs as Doc[]).map((d) => ({ id: d.id as number, number: d.number as number }))) : []
  const idle = nextStep({ ticket: { ...ticket, labels }, need: todo, run: (runs[0] as { id: number; stage: string; status: string; escalation?: { step: number; reason: string } | null } | undefined) ?? null, waiting, blockers: blockers.filter((b) => b.state !== 'closed').map((b) => ({ id: b.id, number: b.number })), holders, admin })
  // OwnerChat hides itself when nothing is open on load; it stays mounted while decisions exist, so the refresh after the last answer keeps its summary.
  const decisionsShown = decisions.length > 0 && !approved
  const history = [summary && approved && 'Plan approved', acceptedStaging && 'Accepted on staging', labels.includes('bauherr:approved:production') && 'Approved for production', ticket.releasedIn && `Released in ${ticket.releasedIn}`].filter(Boolean).join(' · ')
  return { forgeError, plan, worklog, investigation, escalations, decisions, missing, todo, approved, summary, gate, capFindings, reason, stagingSummary, answered, idle, decisionsShown, history }
}
type Derived = Awaited<ReturnType<typeof derive>>

async function Top({ P, d }: { P: Page; d: Promise<Derived> }) {
  const { ticket, product, ws, runs, admin } = P
  const x = await d
  return <ActionBar ticket={ticket.id} product={product.id as number} need={x.todo} stage={runs[0]?.stage ?? stageOf(ticket)} missing={x.missing.map((m) => m.id)} open={x.decisions.length - x.answered} run={runs[0]?.id ?? null} reason={x.reason} idle={x.idle} releaseRunUrl={ticket.releaseRunUrl} stagingUrl={product.stagingUrl} ask={P.ticket.decision?.need === x.todo ? P.ticket.decision.ask : null} canExpedite={admin && ticket.state === 'open' && !ticket.expedite && ws.expediteLane !== false && !['release', 'parent'].includes(stageOf(ticket))} />
}

async function Live({ P, d }: { P: Page; d: Promise<Derived> }) {
  const { ticket } = P
  const x = await d
  return (
    <>
      {x.history && <p className="small text-muted-foreground">{x.history}</p>}
      {x.forgeError && <p className="small text-muted-foreground">The forge could not be reached; plan and worklog are unavailable.</p>}
      {x.gate?.kind === 'release' && <ReleaseGate ticket={ticket.id} timedOut={x.todo === 'Staging not confirmed'} summaryHtml={x.stagingSummary ? renderMarkdown(strip(x.stagingSummary, SUMMARY_MARKER)) : null} />}
      {x.decisionsShown && <OwnerChat ticket={ticket.id} open={x.decisions.length - x.answered} />}
    </>
  )
}

async function DecisionRow({ d }: { d: Promise<Derived> }) {
  const x = await d
  return x.decisions.length > 0 ? <><dt>Decisions</dt><dd>{x.approved ? `${x.answered} answered` : `${x.answered} of ${x.decisions.length} answered · ${x.missing.length} critical open`}</dd></> : null
}

const Section = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-4" aria-labelledby={id}>
    <h2 className="heading" id={id}>{title}</h2>
    {children}
  </section>
)

async function Sections({ d }: { d: Promise<Derived> }) {
  const x = await d
  return (
    <>
      {x.capFindings && x.gate?.kind === 'review-cap' && <Markdown html={renderMarkdown(x.capFindings)} />}
      {x.plan && <Section id="plan" title="Plan"><Markdown html={renderMarkdown(withoutDecisions(strip(x.plan, PLAN_MARKER)))} /></Section>}
      {x.escalations && <Section id="escalations" title="Escalations"><Markdown html={renderMarkdown(strip(x.escalations, ESCALATION_MARKER))} /></Section>}
      {x.investigation && <Section id="investigation" title="Investigation"><Markdown html={renderMarkdown(strip(x.investigation, INVESTIGATION_MARKER))} /></Section>}
      {x.worklog && <Section id="worklog" title="Worklog"><Markdown html={renderMarkdown(withoutWorklogHeading(strip(x.worklog, WORKLOG_MARKER)))} /></Section>}
    </>
  )
}

async function Composer({ ticket, d }: { ticket: number; d: Promise<Derived> }) {
  const x = await d
  return !x.forgeError ? <CommentComposer ticket={ticket} maxBytes={mediaLimits().maxBytes} maxImages={mediaLimits().maxPerSession} /> : null
}

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const wf = DEFAULT()
  const { id } = await params
  const { user, workspace } = await currentWorkspace()
  const admin = isAdmin(user)
  if (!workspace || !/^\d+$/.test(id)) notFound()
  const payload = await payloadClient()
  const q = { depth: 0, overrideAccess: true } as const
  const [ticket] = (await payload.find({ collection: 'tickets', where: { and: [{ id: { equals: id } }, { workspace: { equals: workspace.id } }] }, limit: 1, ...q })).docs as Doc[]
  if (!ticket) notFound()
  const [product, ws, runs, blockers, blocks, shots, epic, spans, touches, forges] = await Promise.all([
    payload.findByID({ collection: 'products', id: ticket.product, ...q }) as Promise<Doc>,
    payload.findByID({ collection: 'workspaces', id: workspace.id, ...q }) as Promise<Doc>,
    payload.find({ collection: 'runs', where: { ticket: { equals: ticket.id } }, sort: '-createdAt', pagination: false, ...(admin ? {} : { select: { stage: true, kind: true, status: true, startedAt: true, finishedAt: true, evidence: true, createdAt: true, error: true, verdict: true, findings: true, reviewedSha: true, mode: true, executor: true, sessionLabel: true, clientName: true, clientVersion: true, model: true, provider: true, outcome: true, artifacts: true } }), ...q }).then((r) => r.docs as Doc[]),
    ticket.blockedBy?.length ? payload.find({ collection: 'tickets', where: { and: [{ id: { in: ticket.blockedBy } }, { workspace: { equals: workspace.id } }] }, pagination: false, ...q }).then((r) => r.docs as Doc[]) : [],
    payload.find({ collection: 'tickets', where: { and: [{ blockedBy: { equals: ticket.id } }, { workspace: { equals: workspace.id } }] }, pagination: false, ...q }).then((r) => r.docs as Doc[]),
    payload.find({ collection: 'media', where: { and: [{ 'session.product': { equals: ticket.product } }, { 'session.ticketNumber': { equals: ticket.number } }, { 'session.status': { equals: 'submitted' } }] }, select: { name: true }, sort: 'id', pagination: false, ...q }).then((r) => r.docs as Doc[]),
    loadEpic(workspace.id, ticket),
    timeline(payload, ticket.id),
    payload.find({ collection: 'human_touches', where: { ticket: { equals: ticket.id } }, pagination: false, ...q }).then((r) => r.docs as Doc[]),
    forgeKinds(payload, workspace.id),
  ])
  const P: Page = { ticket, product, ws, runs, blockers, blocks, shots, admin }
  const forge = forges.get(ticket.product)
  const steps = buildSteps(wf, spans, runs, touches, { current: stageOf(ticket), provider: forge === 'gitlab' ? 'GitLab CI' : forge === 'github' ? 'GitHub Actions' : null, admin })
  const d = derive(payload, P)
  const card = cardOf(ticket, product as never)
  const tiers = Object.entries((ws.modelByTier as Record<string, string> | null) ?? {})

  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={<Pulse h="h-12" />}><Top P={P} d={d} /></Suspense>
      <PageTitle>{`#${ticket.number}`}</PageTitle>
      <h1 className="title">#{ticket.number} {ticket.title}</h1>
      <p className="small text-muted-foreground">{product.name}</p>
      {epic ? (
        <section className="flex flex-col gap-4" aria-labelledby="subtickets">
          <h2 className="heading" id="subtickets">Sub-tickets</h2>
          <EpicProgress epic={epic} />
          <EpicChildren epic={epic} />
        </section>
      ) : (
        <section className="flex flex-col gap-2" aria-labelledby="path">
          <h2 className="heading flex flex-wrap items-baseline gap-x-3" id="path">Path{steps.rounds.map((r) => <span key={r.stage} className="small font-normal text-muted-foreground" data-testid="path-rounds">{r.title}: {r.n} rounds</span>)}</h2>
          <WorkflowGraph wf={wf} variant="path" path={steps.path} />
        </section>
      )}
      {card && <div className="max-w-[640px]"><DecisionCard compact item={{ ...card, product: undefined }} admin={admin} /></div>}
      <Suspense fallback={<Pulse h="h-16" />}><Live P={P} d={d} /></Suspense>

      {!epic && <Section id="steps" title="Steps"><TicketSteps steps={steps} decision={card ? { ticket: ticket.id, ask: card.decision.ask } : null} /></Section>}

      <TicketDetails key={ticket.id}>
        <dl className="body m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:break-words [&_dt]:text-muted-foreground">
          {isWebUrl(ticket.url) && <><dt>Forge</dt><dd><a className="text-primary" href={ticket.url}>Open on the forge</a></dd></>}
          {admin && <><dt>Budget</dt><dd className="mono">{ws.budgetUnit === 'tokens' ? `${ws.budgetTokens30d?.toLocaleString('en')} tokens / 30 days` : `$${ws.budgetUsd30d} / 30 days`}</dd></>}
          {admin && <><dt>Model</dt><dd className="mono">{tiers.map(([tier, m]) => `${tier}: ${m}`).join(' · ') || '—'}</dd></>}
          {admin && ticket.mergeSha && <><dt>Merge commit</dt><dd className="mono">{ticket.mergeSha}</dd></>}
          <Suspense fallback={null}><DecisionRow d={d} /></Suspense>
        </dl>
        {(blockers.length > 0 || blocks.length > 0) && (
          <ul className="small m-0 flex list-none flex-col gap-1 p-0" aria-label="Dependencies">
            {blockers.map((b) => <li key={b.id}>Blocked by <Link className="text-primary" href={`/tickets/${b.id}`}>#{b.number} {b.title}</Link> <span className="text-muted-foreground">({b.state === 'closed' ? 'closed' : 'open'})</span></li>)}
            {blocks.length > 0 && <li>Blocks {blocks.map((b, i) => <span key={b.id}>{i > 0 && ', '}<Link className="text-primary" href={`/tickets/${b.id}`}>#{b.number}</Link></span>)}</li>}
          </ul>
        )}
        <Suspense fallback={<Pulse h="h-24" />}><Sections d={d} /></Suspense>
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
        {admin && <FixState ticket={ticket.id} stage={ticket.stage ?? nameOf(wf, 'triage')} />}
      </TicketDetails>

      <Suspense fallback={null}><Composer ticket={ticket.id} d={d} /></Suspense>
    </div>
  )
}
