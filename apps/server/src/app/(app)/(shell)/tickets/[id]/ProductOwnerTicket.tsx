import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { PageTitle } from '../../../components/PageTitle'
import { ProgressPath } from '../../../components/ProgressPath'
import { ProofList } from '../../../components/ProofList'
import { KindChip, LaneChip, StatusLine } from '../../../components/RequestParts'
import { RequestCardPage } from '../../../components/RequestCardPage'
import { Comments } from '../../../components/RequestComments'
import { ago } from '../../../lib/format'
import { loadProof } from '../../../lib/proof'
import { loadOwnerTicket } from '../../../lib/requests'
import { currentPersonWorkspace, payloadClient } from '../../../lib/session'

/** What a Product owner sees of a Ticket of their Products: the request card, the plain-word path and timeline, who it waits for, proof for review, the release note and the comments. Never a Run, step, cost, token, agent, plan, budget or setting; a Ticket of another Product is a 404. */
export async function ProductOwnerTicket({ id }: { id: string }) {
  const { user, workspace } = await currentPersonWorkspace()
  if (!workspace || !/^\d{1,9}$/.test(id)) notFound()
  const view = await loadOwnerTicket(workspace.id, Number(id), user as { id: number })
  if (!view) notFound()
  const { ticket: t } = view
  const payload = await payloadClient()
  const full = (await payload.findByID({ collection: 'tickets', id: t.id, depth: 0, overrideAccess: true })) as Record<string, any>
  const product = (await payload.findByID({ collection: 'products', id: view.product.id, depth: 0, overrideAccess: true })) as Record<string, any>
  const proof = (await loadProof(payload, [full], new Map([[view.product.id, product]]))).get(t.id)
  return (
    <div className="flex flex-col gap-4" data-testid="owner-ticket">
      <p className="small"><Link className="text-primary" href={view.request ? `/requests/${view.request}` : '/requests'}>{view.request ? 'Request' : 'Requests'}</Link></p>
      <PageTitle>{`#${t.number}`}</PageTitle>
      <h1 className="title m-0">#{t.number} {t.title}</h1>
      <p className="small m-0 flex flex-wrap items-center gap-2 text-muted-foreground">
        {view.product.name}
        <KindChip kind={t.kind} />
        <LaneChip lane={t.lane} />
        <StatusLine status={t.status} waits={t.waits} />
      </p>
      {view.card && <div className="max-w-xl"><RequestCardPage card={view.card} /></div>}
      <section className="flex flex-col gap-3" aria-labelledby="where">
        <h2 className="heading" id="where">Where it stands</h2>
        <p className="body m-0 font-medium" data-testid="request-headline">{t.progress.headline}{t.progress.since && <span className="small font-normal text-muted-foreground"> · since {ago(t.progress.since).replace(/ ago$/, '')}</span>}</p>
        <ProgressPath step={t.progress.step} large />
        {t.progress.detail && <p className="m-0 text-muted-foreground">{t.progress.detail}</p>}
        {t.progress.next && <p className="m-0" data-testid="request-next"><span className="font-medium">What happens next: </span>{t.progress.next}</p>}
        {view.note && <p className="m-0" data-testid="release-note"><span className="font-medium">Release note: </span>{view.note}</p>}
      </section>
      {view.timeline.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="timeline">
          <h2 className="heading" id="timeline">What happened</h2>
          <ol className="m-0 flex list-none flex-col gap-1 p-0" data-testid="timeline">
            {view.timeline.map((e) => (
              <li key={e.text} className="flex gap-3 text-[14px]" data-testid="timeline-entry"><time className="w-16 shrink-0 text-muted-foreground" dateTime={e.at}>{new Date(e.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</time>{e.text}</li>
            ))}
          </ol>
        </section>
      )}
      {proof && <div className="max-w-[860px]"><ProofList data={proof} /></div>}
      <section className="flex flex-col gap-2" aria-labelledby="comments">
        <h2 className="heading" id="comments">Comments</h2>
        <Suspense fallback={<div className="h-16 animate-pulse rounded-sm bg-secondary" aria-busy="true" />}>
          <Comments tickets={[{ id: t.id, number: t.number }]} owner />
        </Suspense>
      </section>
    </div>
  )
}
