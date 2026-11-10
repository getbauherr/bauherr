import Link from 'next/link'
import { EmptyState } from '../../../components/EmptyState'
import { Badge } from '../../../components/ui/badge'
import { Table } from '../../../components/ui/table'
import { ago } from '../../../lib/format'
import { currentWorkspace } from '../../../lib/session'
import { loadTemplates } from '../../../lib/templates'

export const dynamic = 'force-dynamic'

export default async function Templates() {
  const { workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const rows = await loadTemplates(workspace.id)
  return (
    <>
      <h2 className="heading">Templates</h2>
      <p className="small text-muted-foreground">The structure of every text the factory and its agents write for people. Agents get the Workspace&apos;s version with their skill; the factory fills the sections by their anchors, so headings can be renamed and reordered.</p>
      <Table>
        <thead>
          <tr className="label">{['Template', 'Used by', 'Version'].map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td><Link className="text-primary" href={`/settings/templates/${r.name}`}>{r.title}</Link><div className="small text-muted-foreground">{r.description}</div></td>
              <td className="small text-muted-foreground">{r.usedBy}</td>
              <td>{r.custom ? <Badge variant="accent" title={`${r.custom.by ?? 'someone'}, ${ago(r.custom.at)}`}>Customised</Badge> : <Badge>Default</Badge>}{r.custom && <div className="small text-muted-foreground">{r.custom.by ?? 'someone'}, {ago(r.custom.at)}</div>}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  )
}
