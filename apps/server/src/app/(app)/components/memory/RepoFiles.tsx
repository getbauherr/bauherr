import { REACH_LABEL, WARNING_LABEL, type Reach } from '../../../../core/instruction-files'
import type { InstructionFilesView } from '../../../../core/views/instruction-files'

const DOT: Record<Reach, string> = { handed: 'bg-ok', session: 'bg-primary', 'not-loaded': 'bg-warn' }

export function RepoFiles({ view }: { view: InstructionFilesView }) {
  return (
    <section aria-label="Repository files" className="grid gap-2 rounded-md border border-border bg-card p-4">
      <h2 className="label m-0 text-muted-foreground">Repo files</h2>
      {view.files.length === 0 ? (
        <span className="text-muted-foreground">
          {view.read ? 'No file here tells agents what to do.' : 'Not read from the repository yet.'}
        </span>
      ) : (
        <ul className="m-0 grid list-none gap-0 p-0">
          {view.files.map((file) => (
            <li key={file.path} className="grid gap-0.5 border-t border-border py-1.5 first:border-t-0">
              <span className="mono [overflow-wrap:anywhere]">
                {file.path} <span className="whitespace-nowrap text-muted-foreground">({file.lines} lines)</span>
              </span>
              <span className="text-sm text-muted-foreground">
                <span aria-hidden className={`mr-1.5 inline-block size-2 rounded-full ${DOT[file.reach]}`} />
                {REACH_LABEL[file.reach]}
                {file.reach === 'not-loaded' ? ' ⚠' : ''}
              </span>
              {file.warnings.map((warning) => (
                <span key={warning} className="text-sm text-warn">
                  ⚠ {WARNING_LABEL[warning]}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
