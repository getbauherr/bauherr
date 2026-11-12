import { PageTitle } from '../../../components/PageTitle'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { DockOpen } from '../../../components/chat/DockOpen'
import { RequestConversation } from '../../../components/conversation/RequestConversation'
import { ProgressPath } from '../../../components/ProgressPath'
import { KindChip, LaneChip, StatusLine } from '../../../components/RequestParts'
import { ReportProblem } from '../../../components/ReportProblem'
import { RequestCard } from '../../../components/RequestCard'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { ago } from '../../../lib/format'
import { loadRequest } from '../../../lib/requests'
import { currentPersonWorkspace } from '../../../lib/session'
import { isProductOwner } from '../../../../../lib/people'
import { Comments } from '../../../components/RequestComments'

export const dynamic = 'force-dynamic'

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const { id } = await params
  const { view } = await searchParams
  const { user, workspace } = await currentPersonWorkspace()
  const owner = isProductOwner(user)
  if (!workspace || !/^\d{1,9}$/.test(id)) notFound()
  const request = await loadRequest(workspace.id, Number(id), user as { id: number })
  if (!request) notFound()
  // The author's open draft is the conversation; so is their filed request when asked for (read-only history).
  if (request.own || (request.mine && request.sent && view === 'conversation')) return <><PageTitle>{request.own && request.title === 'Untitled request' ? 'New request' : request.title}</PageTitle><RequestConversation session={request.id} owner={owner} /></>
  const next = request.tickets.find((t) => t.need)
  const lead = request.tickets[0]

  return (
    <div className="flex flex-col gap-4">
      <p className="small"><Link className="text-primary" href="/requests">Requests</Link></p>
      <PageTitle>{request.title}</PageTitle>
      <h1 className="title">{request.title}</h1>
      <p className="small flex flex-wrap items-center gap-2 text-muted-foreground">
        {request.card.product?.name} · <Badge variant={request.sent ? 'ok' : 'neutral'}>{request.sent ? 'Sent' : 'Draft'}</Badge>
        <KindChip kind={request.card.kind} />
        <LaneChip urgent={request.card.urgency === 'urgent' && lead?.lane == null} lane={lead?.lane} />
        {lead && <StatusLine status={lead.status} waits={lead.waits} />}
      </p>
      <div className="max-w-xl"><RequestCard card={request.card} /></div>
      <section className="flex flex-col gap-2" aria-labelledby="next">
        <h2 className="heading" id="next">Next step</h2>
        {owner ? (
          <p className="m-0" data-testid="waits-for-you">{next ? `Waiting for you: ${next.need} on #${next.number}.` : request.sent ? 'Nothing for you to do.' : 'A draft.'}</p>
        ) : next ? (
          <Button asChild className="self-start"><Link href={`/tickets/${next.id}`}>{next.need} on #{next.number}</Link></Button>
        ) : (
          <p className="text-muted-foreground">{request.sent ? 'Nothing for you to do.' : 'Only its author can continue this draft.'}</p>
        )}
        {request.mine && request.sent && <Button asChild variant="outline" className="self-start"><Link href={`/requests/${request.id}?view=conversation`}>Open the conversation</Link></Button>}
        {!owner && request.released && <ReportProblem session={request.id} />}
      </section>
      {request.timeline.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="timeline">
          <h2 className="heading" id="timeline">What happened</h2>
          <ol className="m-0 flex list-none flex-col gap-1 p-0" data-testid="timeline">
            {request.timeline.map((e) => (
              <li key={e.text} className="flex gap-3 text-[14px]" data-testid="timeline-entry"><time className="w-16 shrink-0 text-muted-foreground" dateTime={e.at}>{new Date(e.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</time>{e.text}</li>
            ))}
          </ol>
        </section>
      )}
      {request.sent && (
        <section className="flex flex-col gap-2" aria-labelledby="tickets">
          <h2 className="heading" id="tickets">Tickets</h2>
          {request.tickets.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {request.tickets.map((t) => (
                <li key={t.id} className="flex flex-col gap-3 rounded-md border border-border bg-card p-3" data-testid="request-ticket">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link className="text-primary" href={`/tickets/${t.id}`}>#{t.number} {t.title}</Link>
                    <Badge variant={t.status === 'Done' ? 'ok' : 'neutral'}>{t.status}</Badge>
                    <KindChip kind={t.kind} />
                    <LaneChip lane={t.lane} />
                    {t.need && <Badge variant="warn">{t.need}</Badge>}
                    {!owner && t.url && <a className="small text-primary" href={t.url}>Open the issue</a>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!owner && (t.need === 'Answer questions' || t.need === 'Answer decisions') && <Button asChild size="sm"><Link href={`/tickets/${t.id}?view=conversation`}>{t.need}</Link></Button>}
                    {!owner && <DockOpen ticket={t.id} size="sm" variant="outline">Comment on #{t.number}</DockOpen>}
                  </div>
                  <p className="body m-0 font-medium" data-testid="request-headline">{t.progress.headline}{t.progress.since && <span className="small font-normal text-muted-foreground"> · since {ago(t.progress.since).replace(/ ago$/, '')}</span>}</p>
                  <ProgressPath step={t.progress.step} large />
                  {t.progress.detail && <p className="m-0 text-muted-foreground">{t.progress.detail}</p>}
                  {t.progress.next && <p className="m-0" data-testid="request-next"><span className="font-medium">What happens next: </span>{t.progress.next}</p>}
                  {t.progress.link && <Link className="small self-start text-primary" href={t.progress.link}>Open the Ticket</Link>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No Ticket found for this request.</p>
          )}
        </section>
      )}
      {request.tickets.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="comments">
          <h2 className="heading" id="comments">Comments</h2>
          <Suspense fallback={<div className="h-16 animate-pulse rounded-sm bg-secondary" aria-busy="true" />}>
            <Comments tickets={request.tickets} owner={owner} />
          </Suspense>
        </section>
      )}
    </div>
  )
}
