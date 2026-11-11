'use client'
import { useState } from 'react'
import { describeChanges } from '../../../../lib/workflow-describe'
import { readDraft, type Doc } from '../../../../lib/workflow-edit'
import type { VersionRow } from '../../lib/workflow-editor'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'

const VIA: Record<string, string> = { ui: 'Editor', cli: 'Command line', api: 'API', boot: 'Boot file', seed: 'Seed' }
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ')
const docOf = (y: string | null): Doc | null => {
  const d = y === null ? null : readDraft(y)
  return d?.ok ? d.doc : null
}

/** Applied versions, newest first; View shows what changed against the version before, Restore loads one into the draft. */
export function HistoryTab({ versions, active, onRestore, onRestoreShipped }: { versions: VersionRow[]; active: number | null; onRestore: (v: VersionRow) => void; onRestoreShipped: () => void }) {
  const [viewing, setViewing] = useState<number | null>(null)
  return (
    <ol aria-label="Versions" className="m-0 flex list-none flex-col gap-3 p-0">
      {versions.map((v, i) => {
        const older = versions[i + 1]
        const changes = older ? (() => { const a = docOf(older.source), b = docOf(v.source); return a && b ? describeChanges(a, b) : [] })() : null
        return (
          <li key={v.version} data-testid="version" className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">Version {v.version}</span>
                {v.version === active && <Badge variant="ok">Live</Badge>}
                <span className="small text-muted-foreground">{when(v.at)}{v.by && v.via !== 'boot' && v.via !== 'seed' ? ` by ${v.by}` : ''} · {VIA[v.via ?? ''] ?? v.via ?? 'Unknown'}</span>
              </span>
              <span className="flex gap-2">
                <Button variant="outline" size="sm" disabled={v.source === null} aria-expanded={viewing === v.version} onClick={() => setViewing(viewing === v.version ? null : v.version)}>{viewing === v.version ? 'Hide' : 'View'}</Button>
                <Button variant="outline" size="sm" disabled={v.source === null} onClick={() => onRestore(v)}>Restore</Button>
              </span>
            </div>
            {v.note && <p className="small text-muted-foreground">{v.note}</p>}
            {viewing === v.version && (
              <div className="flex flex-col gap-2">
                <h3 className="small font-medium">{changes ? 'What changed since the version before' : 'First version'}</h3>
                {changes && (changes.length ? <ul className="small m-0 flex list-none flex-col gap-1 p-0">{changes.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="small text-muted-foreground">Nothing visible changed.</p>)}
                <pre aria-label={`File of version ${v.version}`} className="mono max-h-80 overflow-auto rounded-md border border-border bg-secondary p-3 text-[13px] leading-5">{v.source}</pre>
              </div>
            )}
          </li>
        )
      })}
      <li data-testid="version-shipped" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border p-3">
        <span className="flex flex-col"><span className="font-semibold">Shipped default</span><span className="small text-muted-foreground">The workflow that comes with Bauherr.</span></span>
        <Button variant="outline" size="sm" onClick={onRestoreShipped}>Restore</Button>
      </li>
    </ol>
  )
}
