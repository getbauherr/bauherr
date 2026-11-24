import type { InstructionFilesView } from '../../../../core/views/instruction-files'
import { RepoFiles } from './RepoFiles'
import { MemoryVersions, type VersionRow } from './MemoryVersions'

type Props = {
  versions: VersionRow[]
  last: string | null
  lines: number
  maxLines: number
  repoFiles: InstructionFilesView | null
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 rounded-md border border-border bg-card p-4">
      <h2 className="label m-0 text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

export function MemorySide({ versions, last, lines, maxLines, repoFiles }: Props) {
  return (
    <aside aria-label="About this document" className="grid gap-4">
      <Card title="Last change">
        <span>{last ?? 'Not edited yet'}</span>
      </Card>
      <Card title="Size">
        <span>
          {lines} of {maxLines} lines
        </span>
      </Card>
      <Card title="Versions">
        <MemoryVersions versions={versions} />
      </Card>
      {repoFiles ? <RepoFiles view={repoFiles} /> : null}
    </aside>
  )
}
