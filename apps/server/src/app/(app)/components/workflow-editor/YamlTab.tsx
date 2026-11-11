'use client'
import { useRef } from 'react'
import { plainFinding } from '../../../../lib/workflow-labels'
import type { Draft } from '../../../../lib/workflow-edit'
import { CopyButton } from '../team/CopyButton'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'

const DOCS = 'https://github.com/getbauherr/bauherr/blob/main/docs/spec/workflow.md'

/** The same draft as text, and the workflow as code: download, upload, the command line and the boot file. */
export function YamlTab({ yaml, setYaml, draft, slug }: { yaml: string; setYaml: (y: string) => void; draft: Draft; slug: string }) {
  const file = useRef<HTMLInputElement>(null)
  const dry = `bauherr apply -f factory.yaml --workspace ${slug} --dry-run`
  const live = `bauherr apply -f factory.yaml --workspace ${slug}`
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Textarea aria-label="Workflow file" spellCheck={false} rows={26} className="mono w-full resize-y text-[13px] leading-5" value={yaml} onChange={(e) => setYaml(e.target.value)} aria-invalid={!draft.ok || undefined} />
        {!draft.ok && <p role="alert" className="small text-destructive">{draft.line ? `Line ${draft.line}: ` : ''}{draft.error}</p>}
        {draft.ok && draft.findings.length > 0 && (
          <ul aria-label="Problems" className="small m-0 flex list-none flex-col gap-1 p-0 text-destructive">{draft.findings.map((f) => <li key={f} role="alert">{plainFinding(f)}</li>)}</ul>
        )}
        {draft.ok && draft.findings.length === 0 && <p role="status" className="small text-muted-foreground">The file passes every rule.</p>}
      </div>
      <section aria-label="Workflow as code" className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
        <h2 className="heading">Workflow as code</h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><a href={`/api/workspaces/${slug}/factory`} download="factory.yaml">Download factory.yaml</a></Button>
          <Button variant="outline" size="sm" onClick={() => file.current?.click()}>Upload a file</Button>
          <input ref={file} type="file" accept=".yaml,.yml,text/yaml" hidden aria-label="Upload a file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setYaml(await f.text()); e.target.value = '' }} />
        </div>
        <p className="small text-muted-foreground">An uploaded file lands in the draft. Nothing is live until you review and apply it.</p>
        {[dry, live].map((c) => (
          <div key={c} className="flex flex-wrap items-center justify-between gap-2">
            <code className="mono small min-w-0 break-all">{c}</code>
            <CopyButton text={c} />
          </div>
        ))}
        <p className="small text-muted-foreground">To load a file when the server starts, set <code className="mono">BAUHERR_FACTORY_FILE</code>. <a className="text-primary" href={DOCS}>How it works</a></p>
      </section>
    </div>
  )
}
