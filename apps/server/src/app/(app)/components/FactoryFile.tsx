'use client'
import { useState, useTransition } from 'react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Textarea } from './ui/textarea'
import { applyFactoryFile, checkFactoryFile, resetFactoryFile, type FactoryAnswer } from '../(shell)/settings/actions'

type Active = { version: number; at: string; by: string | null; via: string | null } | null
type Pending = { kind: 'apply' | 'reset'; summary: FactoryAnswer }

/** Settings > Workflow > Factory file: edit, check (dry run), apply (confirmed in a dialog), download, reset to the shipped default. */
export function FactoryFile({ slug, source, active, custom }: { slug: string; source: string; active: Active; custom: boolean }) {
  const [text, setText] = useState(source)
  const [answer, setAnswer] = useState<FactoryAnswer | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, start] = useTransition()
  const base = active?.version ?? 0
  const show = (r: FactoryAnswer) => setAnswer(r)
  const check = () => start(async () => show(await checkFactoryFile(text, base)))
  const askApply = () =>
    start(async () => {
      const r = await checkFactoryFile(text, base)
      show(r)
      if (r.ok) setPending({ kind: 'apply', summary: r })
    })
  const askReset = () => setPending({ kind: 'reset', summary: { ok: true, findings: [], changed: true, migrated: [], note: 'Replaces the factory file with the one shipped with Bauherr.' } })
  const confirm = () =>
    start(async () => {
      const kind = pending!.kind
      setPending(null)
      const r = kind === 'apply' ? await applyFactoryFile(text, base) : await resetFactoryFile()
      show(r)
      if (r.ok && r.source) setText(r.source)
    })
  return (
    <section className="flex flex-col gap-4">
      <h2 id="factory-file" className="heading">Factory file</h2>
      <p className="small text-muted-foreground">
        {custom && active ? `Custom workflow (version ${active.version})` : 'Shipped default'}
        {active ? `, applied ${active.at.slice(0, 16).replace('T', ' ')} ${active.via === 'boot' || active.via === 'seed' ? `by ${active.via === 'boot' ? 'boot file' : 'seed'}` : `by ${active.by ?? 'unknown'} via ${active.via ?? 'unknown'}`}.` : '. No file applied yet.'} The team and the stages of this Workspace as YAML. Applying changes the Board for everyone.
      </p>
      <Textarea aria-label="Factory file" className="mono min-h-96 w-full font-mono" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={busy} onClick={check}>Check</Button>
        <Button disabled={busy} onClick={askApply}>Apply</Button>
        <Button variant="outline" asChild><a href={`/api/workspaces/${slug}/factory`} download="factory.yaml">Download factory.yaml</a></Button>
        <Button variant="outline" disabled={busy} onClick={askReset}>Reset to the shipped default</Button>
      </div>
      {answer && (
        <div role={answer.ok ? 'status' : 'alert'} className={answer.ok ? 'small text-ok' : 'small text-destructive'}>
          {answer.ok ? <p>{answer.note}</p> : <ul>{answer.findings.map((f) => <li key={f}>{f}</li>)}</ul>}
          {answer.ok && <Migrated rows={answer.migrated} />}
        </div>
      )}
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.kind === 'reset' ? 'Reset to the shipped default?' : 'Apply this factory file?'}</DialogTitle>
            <DialogDescription>{pending?.summary.note}</DialogDescription>
          </DialogHeader>
          {pending && <Migrated rows={pending.summary.migrated} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>Cancel</Button>
            <Button disabled={busy} onClick={confirm}>{pending?.kind === 'reset' ? 'Confirm reset' : 'Confirm apply'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function Migrated({ rows }: { rows: FactoryAnswer['migrated'] }) {
  return rows.length ? <ul className="small">{rows.map((m) => <li key={m.from}>{m.from} becomes {m.to}: {m.tickets} Ticket(s), {m.runs} Run(s)</li>)}</ul> : null
}
