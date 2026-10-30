import { EmptyState } from '../../components/EmptyState'
import { StatusChip } from '../../components/StatusChip'
import { currentWorkspace, payloadClient } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function Runs() {
  const { workspace } = await currentWorkspace()
  const { docs } = workspace
    ? await (await payloadClient()).find({
        collection: 'runs',
        where: { workspace: { equals: workspace.id } },
        sort: '-createdAt',
        limit: 100,
        depth: 1,
        overrideAccess: true,
      })
    : { docs: [] }
  return (
    <>
      <h1 className="title">Runs</h1>
      {docs.length ? (
        <div className="scroll">
          <table className="table">
            <thead>
              <tr className="label">
                {['Run', 'Ticket', 'Stage', 'Status', 'Mode', 'Created'].map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {docs.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td className="mono">#{r.ticket?.number}</td>
                  <td>{r.stage}</td>
                  <td><StatusChip status={r.status} /></td>
                  <td>{r.mode}</td>
                  <td className="mono">{new Date(r.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState text={`No runs in ${workspace?.name ?? 'any Workspace'} yet.`} action={{ href: '/settings/workspace', label: 'Open settings' }} />
      )}
    </>
  )
}
