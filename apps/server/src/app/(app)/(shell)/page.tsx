import { EmptyState } from '../components/EmptyState'
import { payloadClient, currentWorkspace } from '../lib/session'

export const dynamic = 'force-dynamic'

export default async function Tickets() {
  const { workspace } = await currentWorkspace()
  const { docs } = workspace
    ? await (await payloadClient()).find({
        collection: 'tickets',
        where: { workspace: { equals: workspace.id }, state: { not_equals: 'closed' } },
        sort: '-sourceUpdatedAt',
        limit: 100,
        depth: 0,
        overrideAccess: true,
      })
    : { docs: [] }
  return (
    <>
      <h1 className="title">Tickets</h1>
      {docs.length ? (
        <ul className="list">
          {docs.map((t) => (
            <li key={t.id}>
              <a className="mono link" href={t.url ?? undefined}>#{t.number}</a>
              <span className="grow">{t.title}</span>
              <span className="label muted">{t.stage ?? 'triage'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState text={`No tickets in ${workspace?.name ?? 'any Workspace'} yet.`} action={{ href: '/settings/workspace', label: 'Open settings' }} />
      )}
    </>
  )
}
