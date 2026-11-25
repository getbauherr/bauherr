import type { PastVersion } from '../../../../core/releases/view'
import { shortDate } from '../../lib/format'
import { Table } from '../ui/table'

const LINK = 'text-primary underline underline-offset-2'
const noteId = (tag: string) => `notes-${tag}`

export function PastVersions({ past }: { past: PastVersion[] }) {
  const withNotes = past.filter((version) => version.notes !== null)
  return (
    <section aria-labelledby="past" className="grid gap-3">
      <h2 id="past" className="heading">Past versions</h2>
      {past.length === 0 ? (
        <p className="small m-0 text-muted-foreground">No version has been tagged yet.</p>
      ) : (
        <Table aria-label="Past versions">
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Released</th>
              <th scope="col" className="text-right!">Changes</th>
              <th scope="col">Notes</th>
              <th scope="col">Forge</th>
            </tr>
          </thead>
          <tbody>
            {past.map((version) => (
              <tr key={version.tag}>
                <td className="mono">{version.tag}</td>
                <td>{version.at ? shortDate(version.at) : '—'}</td>
                <td className="mono text-right">{version.changes}</td>
                <td>{version.notes !== null && <a href={`#${noteId(version.tag)}`} className={LINK}>Read</a>}</td>
                <td>{version.url && <a href={version.url} className={LINK}>Release on the forge</a>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {withNotes.map((version) => (
        <article key={version.tag} id={noteId(version.tag)} className="grid gap-1 scroll-mt-4">
          <h3 className="label text-muted-foreground">Notes of {version.tag}</h3>
          <p className="m-0 whitespace-pre-wrap">{version.notes}</p>
        </article>
      ))}
    </section>
  )
}
