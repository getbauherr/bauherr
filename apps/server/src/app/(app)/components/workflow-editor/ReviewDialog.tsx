'use client'
import { useEffect, useState } from 'react'
import type { ApplyResult } from '../../../../lib/factory'
import { stagesOf, type Doc } from '../../../../lib/workflow-edit'
import { plainFinding, STALE, stageTitle } from '../../../../lib/workflow-labels'
import { applyDraft, reviewDraft } from '../../(shell)/workflow/edit/actions'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { NativeSelect } from '../ui/native-select'

type Props = {
  open: boolean
  onClose: () => void
  yaml: string
  baseDoc: Doc
  doc: Doc
  baseVersion: number | null
  changes: string[]
  problems: string[]
  note: string
  onNote: (v: string) => void
  onMigrate: (from: string, to: string) => void
  onApplied: (version: number | undefined) => void
  onLoadCurrent: () => void
  onContinueInYaml: () => void
}

/** What will change, what is wrong, what happens to open tickets, then Apply. The server checks the draft too. */
export function ReviewDialog(p: Props) {
  const [check, setCheck] = useState<ApplyResult | null>(null)
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!p.open) return
    let live = true
    setCheck(null)
    reviewDraft(p.yaml, p.baseVersion).then((r) => live && (setCheck(r), setStale(r.findings.includes(STALE))), () => live && setError('The check did not finish. Try again.'))
    return () => void (live = false)
  }, [p.open, p.yaml, p.baseVersion])
  const base = stagesOf(p.baseDoc)
  const now = stagesOf(p.doc)
  const chosen = (p.doc.workflow?.migrate ?? {}) as Record<string, string>
  const held = new Map<string, { tickets: number; runs: number }>([...(check?.held ?? []).map((h) => [h.stage, h] as const), ...(check?.migrated ?? []).map((m) => [m.from, m] as const)])
  const removed = base.filter((s) => !now.some((x) => x.name === s.name) && (held.get(s.name)?.tickets || held.get(s.name)?.runs))
  const unresolved = removed.filter((s) => !chosen[s.name])
  const server = stale ? [] : (check?.findings ?? []).filter((f) => !/is removed but holds/.test(f))
  const canApply = !!check?.ok && check.changed && !busy && p.problems.length === 0 && server.length === 0 && !stale && unresolved.length === 0
  const apply = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await applyDraft(p.yaml, p.baseVersion, p.note)
      if (r.ok) return p.onApplied(r.version)
      if (r.findings.includes(STALE)) setStale(true)
      else setCheck(r)
    } catch {
      setError('Applying did not finish. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Review changes</DialogTitle>
          <DialogDescription>Nothing is live until you press Apply.</DialogDescription>
        </DialogHeader>
        {stale && (
          <div role="alert" data-testid="stale" className="flex flex-col gap-2 rounded-md border border-warn p-3">
            <p className="small">The workflow changed since you loaded it. Your draft is kept.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={p.onLoadCurrent}>Load the current version</Button>
              <Button variant="outline" size="sm" onClick={p.onContinueInYaml}>Continue in YAML</Button>
            </div>
          </div>
        )}
        <section aria-label="What changes" className="flex flex-col gap-2">
          <h3 className="heading">What changes</h3>
          {p.changes.length ? <ul className="small m-0 flex list-none flex-col gap-1 p-0">{p.changes.map((c) => <li key={c}>{c}</li>)}</ul> : <p className="small text-muted-foreground">Nothing visible changes.</p>}
        </section>
        {(p.problems.length > 0 || server.length > 0) && (
          <section aria-label="Problems" className="flex flex-col gap-2">
            <h3 className="heading text-destructive">Problems</h3>
            <ul className="small m-0 flex list-none flex-col gap-1 p-0">{[...p.problems, ...server.filter((f) => !p.problems.includes(f))].map((f) => <li key={f} role="alert">{plainFinding(f)}</li>)}</ul>
          </section>
        )}
        {removed.length > 0 && (
          <section aria-label="Open tickets" className="flex flex-col gap-3">
            <h3 className="heading">Open tickets</h3>
            {removed.map((s) => {
              const h = held.get(s.name)!
              const n = h.tickets
              return (
                <div key={s.name} className="flex flex-col gap-1.5">
                  <Label htmlFor={`move-${s.name}`} className="small">
                    {n} {n === 1 ? 'ticket is' : 'tickets are'} in {stageTitle(s)}{h.runs ? ` and ${h.runs} active ${h.runs === 1 ? 'run' : 'runs'} work on them` : ''}. Move them to:
                  </Label>
                  <NativeSelect id={`move-${s.name}`} value={chosen[s.name] ?? ''} onChange={(e) => p.onMigrate(s.name, e.target.value)}>
                    <option value="" disabled>Choose a step</option>
                    {now.filter((x) => x.kind !== 'container').map((x) => <option key={x.name} value={x.name}>{stageTitle(x)}</option>)}
                  </NativeSelect>
                </div>
              )
            })}
          </section>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="review-note" className="small">What changed (optional)</Label>
          <Input id="review-note" value={p.note} onChange={(e) => p.onNote(e.target.value)} placeholder="Shown in History" />
        </div>
        {!check && !error && <p role="status" className="small text-muted-foreground">Checking the draft…</p>}
        {check && check.ok && !check.changed && <p role="status" className="small text-muted-foreground">This draft is identical to the live version.</p>}
        {error && <p role="alert" className="small text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={p.onClose}>Cancel</Button>
          <Button disabled={!canApply} onClick={apply}>{busy ? 'Applying…' : 'Apply'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
