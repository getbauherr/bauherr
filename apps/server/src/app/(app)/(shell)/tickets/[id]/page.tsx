import { PageTitle } from '../../../components/PageTitle'
import { ProductOwnerTicket } from './ProductOwnerTicket'
import { isProductOwner } from '../../../../../lib/people'
import { APPROVED_PLAN } from '@bauherr/adapters'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { OPEN_WORDS, sourceOf, type OpenItem } from '../../../../../lib/actions'
import { decisionComments } from '../../../../../lib/forge-channel'
import { expediteAction } from '../../../lib/actions'
import { NEEDS_REFINEMENT } from '../../../../../lib/needs-you'
import { Button } from '../../../components/ui/button'
import { FixState } from '../../../components/FixState'
import { EpicChildren, EpicProgress } from '../../../components/Epics'
import { ActionBar, FAST_LANE_HELP } from '../../../components/ActionBar'
import { DecisionCard } from '../../../components/DecisionCard'
import { DockOpen } from '../../../components/chat/DockOpen'
import { RefineConversation } from '../../../components/conversation/RefineConversation'
import { SubmitButton } from '../../../components/SubmitButton'
import { ReleaseGate } from '../../../components/Gate'
import { Markdown } from '../../../components/Markdown'
import { ProofList } from '../../../components/ProofList'
import { loadProof } from '../../../lib/proof'
import { TicketSteps } from '../../../components/workflow/TicketSteps'
import { WorkflowGraph } from '../../../components/workflow/WorkflowGraph'
import { StatusChip } from '../../../components/StatusChip'
import { TicketFacts } from '../../../components/TicketFacts'
import { Badge } from '../../../components/ui/badge'
import { TicketDetails } from '../../../components/TicketDetails'
import { Table } from '../../../components/ui/table'
import { hasProductionChecks } from '../../../../../lib/mode'
import { SUMMARY_MARKER, bullets, section as summarySection } from '../../../../../lib/summary'
import { cardOf } from '../../../lib/inbox'
import { forgeKinds, kindOfLabels, loadEpic, within } from '../../../lib/overview'
import { buildSteps } from '../../../lib/steps'
import { skips, timeline } from '../../../../../lib/history'
import { renderMarkdown } from '../../../lib/markdown'
import { GATES } from '../../../lib/gates'
import { nextStep } from '../../../../../lib/next-step'
import { needsYou, reviewWord, stageOf } from '../../../lib/needs-you'
import { is, nameOf, roleOf, title as stageTitle, type Workflow } from '../../../../../lib/workflow'
import { activeVersion, workflowFor } from '../../../../../lib/factory'
import { ESCALATION_MARKER, INVESTIGATION_MARKER, PLAN_MARKER, WORKLOG_MARKER, firstWith, latestWith, parseAnswers, parseDecisions, planSummary, answersOf, sheetOf, unansweredCritical, withoutDecisions, withoutWorklogHeading } from '../../../lib/plan'
import { ago } from '../../../lib/format'
import { runWho, ticketStatus, type StatusRow, type StatusRun } from '../../../lib/status'
import { isAdmin } from '../../../lib/settings'
import { currentWorkspace, payloadClient, requirePerson } from '../../../lib/session'
import { isWebUrl } from '../../../lib/url'
import { KindChip } from '../../../components/RequestParts'
import { KIND_LABEL } from '../../../../../lib/intake/kinds'
import { waitingLabel } from '../../../../../lib/wip'
import { fastLaneHolder } from '../../../../../lib/expedite'
import { fastLaneText } from '../../../../../lib/hold-text'
import { connectedOfRole } from '../../../../../lib/presence'

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
type Page = { wf: Workflow; ticket: Doc; product: Doc; ws: Doc; runs: Doc[]; blockers: Doc[]; blocks: Doc[]; shots: Doc[]; admin: boolean }

/** Everything derived from the forge comments and labels of the Ticket. */
async function derive(payload: Awaited<ReturnType<typeof payloadClient>>, P: Page) {
  const { wf, ticket, product, runs, blockers, admin } = P
  const live = await within(
    (async () => {
      const { ts, n } = await sourceOf(payload, ticket)
      const [comments, t] = await Promise.all([decisionComments(payload, ticket, ts), ts.get(n)])
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
  const todo = needsYou(wf, { stage: ticket.stage, labels, releaseState: ticket.releaseState, productionState: ticket.productionState, productionChecksMissing: !hasProductionChecks(product), releaseChecksState: ticket.releaseChecksState, reviewState: ticket.reviewState, reviewRounds: ticket.reviewRounds, expedite: ticket.expedite, waitingFor: ticket.waitingFor }, (runs[0] as { stage: string; status: string; reasonKind?: string | null } | undefined) ?? null, missing.length)
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
  const live0 = (runs[0] as { id: number; stage: string; status: string; escalation?: { step: number; reason: string } | null } | undefined) ?? null
  const roleId = live0?.status === 'awaiting_session' ? roleOf(wf, live0.stage)?.id : undefined
  const connected = roleId ? (await connectedOfRole(payload, P.ws.id, roleId)) > 0 : true
  const fastLane = await fastLaneHolder(payload, ticket)
  const next = nextStep({ wf, ticket: { ...ticket, labels }, need: todo, run: live0, connected, waiting, blockers: blockers.filter((b) => b.state !== 'closed').map((b) => ({ id: b.id, number: b.number })), holders, admin })
  const idle = fastLane && !todo && (!live0 || live0.status === 'queued') && !blockers.some((b) => b.state !== 'closed') ? { ...next, label: 'Queued', enabled: false, reason: fastLaneText(fastLane), links: [] } : next
  const decisionsShown = decisions.length > 0 && !approved
  const history = [summary && approved && 'Plan approved', acceptedStaging && 'Accepted on staging', labels.includes('bauherr:approved:production') && 'Approved for production', ticket.releasedIn && `Released in ${ticket.releasedIn}`].filter(Boolean).join(' · ')
  return { labels, forgeError, plan, worklog, investigation, escalations, decisions, missing, todo, approved, summary, gate, capFindings, reason, stagingSummary, answered, idle, decisionsShown, history }
}
type Derived = Awaited<ReturnType<typeof derive>>

const canExpediteOf = (P: Page) => P.admin && P.ticket.state === 'open' && !P.ticket.expedite && P.ws.expediteLane !== false && !is(P.wf, stageOf(P.wf, P.ticket), 'release', 'container')

async function Top({ P, d }: { P: Page; d: Promise<Derived> }) {
  const { ticket, product, ws, runs, admin } = P
  const x = await d
  return <ActionBar ticket={ticket.id} product={product.id as number} need={x.todo} stage={runs[0]?.stage ?? stageOf(P.wf, ticket)} missing={x.missing.map((m) => m.id)} open={x.decisions.length - x.answered} answerable={x.decisionsShown ? x.decisions.length - x.answered : 0} run={runs[0]?.id ?? null} reason={x.reason} idle={x.idle} releaseRunUrl={ticket.releaseRunUrl} stagingUrl={product.stagingUrl} ask={P.ticket.decision?.need === x.todo ? P.ticket.decision.ask : null} canExpedite={canExpediteOf(P)} />
}

async function Live({ P, d }: { P: Page; d: Promise<Derived> }) {
  const { ticket } = P
  const x = await d
  return (
    <>
      {x.history && <p className="small text-muted-foreground">{x.history}</p>}
      {x.forgeError && <p className="small text-muted-foreground">The forge could not be reached; plan and worklog are unavailable.</p>}
      {x.gate?.kind === 'release' && <ReleaseGate ticket={ticket.id} timedOut={x.todo === 'Staging not confirmed'} summaryHtml={x.stagingSummary ? renderMarkdown(strip(x.stagingSummary, SUMMARY_MARKER)) : null} />}
    </>
  )
}

/** The proof table of the Ticket: its request's acceptance criteria, else the plan's Goal statements. */
async function Proof({ P, d }: { P: Page; d: Promise<Derived> }) {
  const { plan } = await d
  const proof = (await loadProof(await payloadClient(), [P.ticket], new Map([[P.product.id as number, P.product]]), () => bullets(summarySection(plan ?? '', 'Goal')))).get(P.ticket.id)
  return proof ? <div className="max-w-[860px]"><ProofList data={proof} /></div> : null
}

async function DecisionRow({ d }: { d: Promise<Derived> }) {
  const x = await d
  return x.decisions.length > 0 ? <><dt>Decisions</dt><dd>{x.approved ? `${x.answered} answered` : `${x.answered} of ${x.decisions.length} answered · ${x.missing.length} critical open`}</dd></> : null
}

/** The entry to the conversation (read-only once the Ticket was sent on) for a Ticket that ever had open points. */
async function ConversationLink({ ticket, d }: { ticket: number; d: Promise<Derived> }) {
  const x = await d
  return x.decisions.length > 0 ? <p className="m-0"><Button asChild variant="outline" size="sm" data-testid="open-conversation"><Link href={`/tickets/${ticket}?view=conversation`}>Conversation</Link></Button></p> : null
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

/** What the latest review noted but did not send back (read from the stored review Run). */
const Noted = ({ items }: { items: OpenItem[] }) =>
  items.length > 0 ? (
    <Section id="noted" title="Noted, not sent back">
      <ul className="small flex list-disc flex-col gap-1 pl-5">
        {items.map((x, i) => <li key={i}>{x.text} <span className="text-muted-foreground">({OPEN_WORDS[x.reason] ?? x.reason})</span></li>)}
      </ul>
    </Section>
  ) : null

export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const { id } = await params
  const { view } = await searchParams
  if (isProductOwner(await requirePerson())) return await ProductOwnerTicket({ id, view })
  const { user, workspace } = await currentWorkspace()
  const wf = workflowFor(workspace?.id)
  const admin = isAdmin(user)
  if (!workspace || !/^\d+$/.test(id)) notFound()
  const payload = await payloadClient()
  const q = { depth: 0, overrideAccess: true } as const
  const [ticket] = (await payload.find({ collection: 'tickets', where: { and: [{ id: { equals: id } }, { workspace: { equals: workspace.id } }] }, limit: 1, ...q })).docs as Doc[]
  if (!ticket) notFound()
  const [product, ws, runs, blockers, blocks, shots, epic, spans, skipped, touches, forges] = await Promise.all([
    payload.findByID({ collection: 'products', id: ticket.product, ...q }) as Promise<Doc>,
    payload.findByID({ collection: 'workspaces', id: workspace.id, ...q }) as Promise<Doc>,
    payload.find({ collection: 'runs', where: { ticket: { equals: ticket.id } }, sort: '-createdAt', pagination: false, ...(admin ? {} : { select: { stage: true, kind: true, status: true, startedAt: true, finishedAt: true, evidence: true, createdAt: true, error: true, verdict: true, findings: true, reviewedSha: true, mode: true, executor: true, role: true, sessionLabel: true, session: true, clientName: true, clientVersion: true, model: true, provider: true, outcome: true, artifacts: true } }), ...q }).then((r) => r.docs as Doc[]),
    ticket.blockedBy?.length ? payload.find({ collection: 'tickets', where: { and: [{ id: { in: ticket.blockedBy } }, { workspace: { equals: workspace.id } }] }, pagination: false, ...q }).then((r) => r.docs as Doc[]) : [],
    payload.find({ collection: 'tickets', where: { and: [{ blockedBy: { equals: ticket.id } }, { workspace: { equals: workspace.id } }] }, pagination: false, ...q }).then((r) => r.docs as Doc[]),
    payload.find({ collection: 'media', where: { and: [{ 'session.product': { equals: ticket.product } }, { 'session.ticketNumber': { equals: ticket.number } }, { 'session.status': { equals: 'submitted' } }] }, select: { name: true }, sort: 'id', pagination: false, ...q }).then((r) => r.docs as Doc[]),
    loadEpic(workspace.id, ticket),
    timeline(payload, ticket.id),
    skips(payload, ticket.id),
    payload.find({ collection: 'human_touches', where: { ticket: { equals: ticket.id } }, pagination: false, ...q }).then((r) => r.docs as Doc[]),
    forgeKinds(payload, workspace.id),
  ])
  const noted = ((await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: ticket.id } }, { kind: { equals: 'review' } }, { status: { equals: 'succeeded' } }] }, sort: '-createdAt', limit: 1, select: { artifacts: true }, ...q })).docs[0] as Doc | undefined)?.artifacts?.review?.open as OpenItem[] | undefined
  const inherited = ticket.inheritedApprovalFrom ? ((await payload.findByID({ collection: 'tickets', id: ticket.inheritedApprovalFrom, select: { number: true }, ...q }).catch(() => null)) as { id: number; number: number } | null) : null
  const P: Page = { wf, ticket, product, ws, runs, blockers, blocks, shots, admin }
  const forge = forges.get(ticket.product)
  const sessionIds = [...new Set(runs.map((r) => (typeof r.session === 'object' ? r.session?.id : r.session)).filter(Boolean))]
  const sessions = new Map<number, string>(sessionIds.length ? ((await payload.find({ collection: 'agent_sessions', where: { id: { in: sessionIds } }, select: { publicId: true }, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as { id: number; publicId: string }[]).map((x) => [x.id, x.publicId]) : [])
  const steps = buildSteps(wf, spans, runs, touches, { sessions, workflowVersion: (await activeVersion(payload, workspace.id))?.version ?? null, skips: skipped, current: stageOf(wf, ticket), provider: forge === 'gitlab' ? 'GitLab CI' : forge === 'github' ? 'GitHub Actions' : null, admin })
  const d = derive(payload, P)
  const card = cardOf(ticket, product as never)
  const tiers = Object.entries((ws.modelByTier as Record<string, string> | null) ?? {})
  const latest = runs[0] as Doc | undefined
  const status = ticketStatus(wf, {
    open: ticket.state === 'open',
    stage: stageOf(wf, ticket),
    needsYou: ticket.needsYou ?? null,
    blockedBy: blockers.filter((b) => b.state !== 'closed').map((b) => ({ number: b.number as number })),
    queuedWhy: ticket.waitingReason ?? null,
    run: (latest as StatusRun | undefined) ?? null,
    owner: null,
    forge: forge === 'gitlab' || forge === 'github' ? forge : null,
    gate: null,
    children: epic ? { total: epic.children.length, done: epic.children.filter((c) => !c.open).length } : null,
    track: { waitingFor: ticket.waitingFor, reviewState: ticket.reviewState, releaseState: ticket.releaseState, productionState: ticket.productionState, releaseChecksState: ticket.releaseChecksState, releaseError: ticket.releaseError },
  } satisfies StatusRow)
  const roleOf = (r: Doc) => wf.roles.find((x) => x.id === r.role)?.title
  const executor = latest ? runWho(latest as StatusRun, null, roleOf(latest)) : null
  const prUrl = runs.find((r) => r.artifacts?.prUrl)?.artifacts.prUrl as string | undefined
  const links = [
    ...(isWebUrl(ticket.url) ? [{ label: 'Issue', href: ticket.url as string }] : []),
    ...(isWebUrl(prUrl) ? [{ label: 'Merge request', href: prUrl! }] : []),
    ...(latest ? [{ label: `Run #${latest.id}`, href: `/runs/${latest.id}` }] : []),
  ]
  const budget = ws.budgetUnit === 'tokens' ? `${ws.budgetTokens30d?.toLocaleString('en')} tokens / 30 days` : '$' + ws.budgetUsd30d + ' / 30 days'

  const x = await d
  const waiting = x.labels.includes(NEEDS_REFINEMENT) && x.decisions.length > 0 && !x.approved
  if (view === 'conversation' || (waiting && view !== 'ticket')) {
    return (
      <>
        <PageTitle>{`#${ticket.number}`}</PageTitle>
        <RefineConversation
          ticket={ticket.id}
          kind={kindOfLabels(ticket.labels) ? KIND_LABEL[kindOfLabels(ticket.labels)!] : null}
          where={[status.label, status.detail].filter(Boolean).join(' · ')}
          info={
            <>
              <TicketFacts product={product.name} stage={stageTitle(wf, stageOf(wf, ticket))} totals={steps.totals} runs={runs.length} models={[...new Set(runs.map((r) => r.model as string | null).filter((m): m is string => !!m))]} executor={executor} links={links} />
              {(blockers.length > 0 || blocks.length > 0) && (
                <ul className="small m-0 flex list-none flex-col gap-1 p-0" aria-label="Dependencies">
                  {blockers.map((b) => <li key={b.id}>Blocked by <Link className="text-primary" href={`/tickets/${b.id}`}>#{b.number} {b.title}</Link></li>)}
                  {blocks.length > 0 && <li>Blocks {blocks.map((b, i) => <span key={b.id}>{i > 0 && ', '}<Link className="text-primary" href={`/tickets/${b.id}`}>#{b.number}</Link></span>)}</li>}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                {canExpediteOf(P) && <form action={expediteAction}><input type="hidden" name="ticket" value={ticket.id} /><SubmitButton variant="outline" title={FAST_LANE_HELP}>Put on the fast lane</SubmitButton></form>}
                <DockOpen ticket={ticket.id} variant="outline">Comment</DockOpen>
              </div>
            </>
          }
        />
      </>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={<Pulse h="h-12" />}><Top P={P} d={d} /></Suspense>
      <PageTitle>{`#${ticket.number}`}</PageTitle>
      <div className="@container">
        <div className="grid items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <header className="flex flex-col gap-2">
              <h1 className="title m-0">#{ticket.number} {ticket.title}</h1>
              {kindOfLabels(ticket.labels) && <p className="m-0 flex flex-wrap gap-2"><KindChip kind={kindOfLabels(ticket.labels)} /></p>}
              <Suspense fallback={null}><ConversationLink ticket={ticket.id} d={d} /></Suspense>
              <p className="body m-0 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="ticket-status">
                <Badge variant={status.tone}>{status.label}</Badge>
                {status.detail && <span>{status.detail}</span>}
                {(status.who ?? executor) && <span className="small text-muted-foreground">{status.who ?? `Last: ${executor}`}</span>}
              </p>
            </header>
            {card && <div className="max-w-[640px]"><DecisionCard compact item={{ ...card, product: undefined }} admin={admin} /></div>}
            <Suspense fallback={<Pulse h="h-16" />}><Live P={P} d={d} /></Suspense>
            <Suspense fallback={null}><Proof P={P} d={d} /></Suspense>
            {epic ? (
              <section className="flex flex-col gap-4" aria-labelledby="subtickets">
                <h2 className="heading" id="subtickets">Sub-tickets</h2>
                <EpicProgress wf={wf} epic={epic} />
                <EpicChildren wf={wf} epic={epic} />
              </section>
            ) : (
              <>
                <section className="flex flex-col gap-2" aria-labelledby="path">
                  <h2 className="heading flex flex-wrap items-baseline gap-x-3" id="path">Path{steps.rounds.map((r) => <span key={r.stage} className="small font-normal text-muted-foreground" data-testid="path-rounds">{r.title}: {r.n} rounds</span>)}</h2>
                  <WorkflowGraph wf={wf} variant="path" path={steps.path} />
                </section>
                <Section id="steps" title="Steps"><TicketSteps steps={steps} decision={card ? { ticket: ticket.id, ask: card.decision.ask } : null} /></Section>
              </>
            )}

            <TicketDetails key={ticket.id}>
              <dl className="body m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 [&_dd]:m-0 [&_dd]:min-w-0 [&_dd]:break-words [&_dt]:text-muted-foreground">
                {admin && <><dt>Budget</dt><dd className="mono">{budget}</dd></>}
                {admin && <><dt>Model</dt><dd className="mono">{tiers.map(([tier, m]) => `${tier}: ${m}`).join(' · ') || '—'}</dd></>}
                {ticket.releasedAt && <><dt>Released</dt><dd>{ago(ticket.releasedAt)}</dd></>}
                {inherited && <><dt>Plan</dt><dd>Approved with parent <Link className="text-primary" href={`/tickets/${inherited.id}`}>#{inherited.number}</Link></dd></>}
                {admin && ticket.mergeSha && <><dt>Merge commit</dt><dd className="mono">{ticket.mergeSha}</dd></>}
                <Suspense fallback={null}><DecisionRow d={d} /></Suspense>
              </dl>
              <Suspense fallback={<Pulse h="h-24" />}><Sections d={d} /></Suspense>
              <Noted items={noted ?? []} />
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
            </TicketDetails>
          </div>

          <aside className="flex min-w-0 flex-col gap-6 @3xl:sticky @3xl:top-[calc(var(--next-step-h,0px)+var(--space-4))]" aria-label="About this Ticket">
            <TicketFacts product={product.name} stage={stageTitle(wf, stageOf(wf, ticket))} totals={steps.totals} runs={runs.length} models={[...new Set(runs.map((r) => r.model as string | null).filter((m): m is string => !!m))]} executor={executor} links={links} />
            {(blockers.length > 0 || blocks.length > 0) && (
              <ul className="small m-0 flex list-none flex-col gap-1 p-0" aria-label="Dependencies">
                {blockers.map((b) => <li key={b.id}>Blocked by <Link className="text-primary" href={`/tickets/${b.id}`}>#{b.number} {b.title}</Link> <span className="text-muted-foreground">({b.state === 'closed' ? 'closed' : 'open'})</span></li>)}
                {blocks.length > 0 && <li>Blocks {blocks.map((b, i) => <span key={b.id}>{i > 0 && ', '}<Link className="text-primary" href={`/tickets/${b.id}`}>#{b.number}</Link></span>)}</li>}
              </ul>
            )}
            {admin && <FixState wf={wf} ticket={ticket.id} stage={ticket.stage ?? nameOf(wf, 'triage')} counters={(['reviewRounds', 'gatePendingAttempts', 'triageAttempts', 'mergeFailures', 'trainFailures', 'conflictReturns', 'mainMergeNoops', 'releaseAttempts'] as const).map((c) => [c, Number(ticket[c] ?? 0)] as [string, number])} />}
          </aside>
        </div>
      </div>
    </div>
  )
}
