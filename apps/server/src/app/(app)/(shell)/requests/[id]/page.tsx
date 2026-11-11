import { PageTitle } from '../../../components/PageTitle'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { sourceOf } from '../../../../../lib/actions'
import { Markdown } from '../../../components/Markdown'
import { DockOpen, RequestOpen } from '../../../components/chat/DockOpen'
import { DiscardDraft } from '../../../components/DiscardDraft'
import { ProgressPath } from '../../../components/ProgressPath'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { ago } from '../../../lib/format'
import { renderMarkdown } from '../../../lib/markdown'
import { within } from '../../../lib/overview'
import { loadRequest } from '../../../lib/requests'
import { currentWorkspace, payloadClient } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const COMMENTS_MS = 5000

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { user, workspace } = await currentWorkspace()
  if (!workspace || !/^\d{1,9}$/.test(id)) notFound()
  const request = await loadRequest(workspace.id, Number(id), user.id as number)
  if (!request) notFound()
  const next = request.tickets.find((t) => t.need)

  return (
    <div className="flex flex-col gap-4">
      <p className="small"><Link className="text-primary" href="/requests">Requests</Link></p>
      <PageTitle>{request.problem || 'Untitled request'}</PageTitle>
      <h1 className="title">{request.problem || 'Untitled request'}</h1>
      <p className="small text-muted-foreground">{request.product} · <Badge variant={request.sent ? 'ok' : 'neutral'}>{request.sent ? 'Sent' : 'Draft'}</Badge></p>
      {request.context && <Markdown html={renderMarkdown(request.context)} />}
      {request.criteria.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="criteria">
          <h2 className="heading" id="criteria">Acceptance criteria</h2>
          <ul className="m-0 pl-6">{request.criteria.map((c) => <li key={c}>{c}</li>)}</ul>
        </section>
      )}
      <section className="flex flex-col gap-2" aria-labelledby="next">
        <h2 className="heading" id="next">Next step</h2>
        {request.own ? (
          <div className="flex flex-wrap gap-2">
            <RequestOpen request={request.id}>Continue draft</RequestOpen>
            <DiscardDraft session={request.id} title={request.problem || 'Untitled request'} />
          </div>
        ) : next ? (
          <Button asChild className="self-start"><Link href={`/tickets/${next.id}`}>{next.need} on #{next.number}</Link></Button>
        ) : (
          <p className="text-muted-foreground">{request.sent ? 'Nothing for you to do.' : 'Only its author can continue this draft.'}</p>
        )}
        {request.mine && request.sent && <RequestOpen request={request.id} variant="outline" className="self-start">Open the conversation</RequestOpen>}
      </section>
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
                    {t.need && <Badge variant="warn">{t.need}</Badge>}
                    {t.url && <a className="small text-primary" href={t.url}>Open the issue</a>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(t.need === 'Answer questions' || t.need === 'Answer decisions') && <DockOpen ticket={t.id} mode="answer" size="sm">{t.need}</DockOpen>}
                    <DockOpen ticket={t.id} mode="comment" size="sm" variant="outline">Comment on #{t.number}</DockOpen>
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
            <Comments tickets={request.tickets} />
          </Suspense>
        </section>
      )}
    </div>
  )
}

/** The forge-backed Comments, streamed after the page; 5 s per Ticket, then "could not be reached". */
async function Comments({ tickets }: { tickets: { id: number; number: number }[] }) {
  const payload = await payloadClient()
  let forgeError = false
  const comments = (
    await Promise.all(
      tickets.map(async (t) => {
        try {
          const { ts, n } = await sourceOf(payload, (await payload.findByID({ collection: 'tickets', id: t.id, depth: 0, overrideAccess: true })) as never)
          return (await within(ts.listComments(n), COMMENTS_MS)).filter((c) => !c.body.startsWith('<!-- bauherr:')).map((c) => ({ ...c, ticket: t.number }))
        } catch {
          forgeError = true
          return []
        }
      }),
    )
  ).flat().sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return (
    <>
      {forgeError && <p className="small text-muted-foreground">The forge could not be reached; some comments are unavailable.</p>}
      {comments.length ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {comments.map((c) => (
            <li key={`${c.ticket}-${c.id}`} className="flex flex-col gap-1" data-testid="request-comment">
              <p className="small m-0 text-muted-foreground">#{c.ticket} · {c.author} · {ago(c.createdAt)}</p>
              <Markdown html={renderMarkdown(c.body)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No comments yet.</p>
      )}
    </>
  )
}
