'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { previewRelease, shipReleaseAction, summariseRelease } from '../(shell)/releases/actions'
import { Markdown } from './Markdown'
import { NextStepBar } from './NextStepBar'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Textarea } from './ui/textarea'

type Row = { id: number; number: number; title: string; kind: string }
type Past = { tag: string; url: string; at: string | null; html: string }

const VERSION = /^\d+\.\d+\.\d+(-rc\.\d+)?$/

/** Tickets waiting for a release (ticked), the proposed version (a select of the bumps), the notes and an optional model-written summary (both editable; the summary only on the Summarise button), the ship button in the next-step bar, and the past releases. */
export function ReleasePanel({ product, admin, tickets, version: v0, versions, notes: n0, past }: { product: number; admin: boolean; tickets: Row[]; version: string; versions: string[]; notes: string; past: Past[] }) {
  const router = useRouter()
  const [picked, setPicked] = useState(() => new Set(tickets.map((t) => t.id)))
  const [version, setVersion] = useState(v0)
  const [notes, setNotes] = useState(n0)
  const [summary, setSummary] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const generated = useRef({ version: v0, notes: n0 })
  const latest = useRef(0)
  const n = picked.size

  const toggle = (id: number) => {
    const next = new Set(picked)
    next.has(id) ? next.delete(id) : next.add(id)
    setPicked(next)
  }
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const call = ++latest.current
    const timer = setTimeout(() => start(async () => {
      const r = await previewRelease({ product, ids: [...picked] })
      if (call !== latest.current) return
      if ('error' in r) return setError(r.error)
      setError(null)
      if (version === generated.current.version) setVersion(r.version)
      if (notes === generated.current.notes) setNotes(r.notes)
      generated.current = r
    }), 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked])
  const summarise = () =>
    start(async () => {
      const r = await summariseRelease({ product, ids: [...picked] })
      if ('error' in r) return setError(r.error)
      setError(null)
      setSummary(r.summary)
    })
  const ship = () =>
    start(async () => {
      const r = await shipReleaseAction({ product, ids: [...picked], version, notes, summary })
      if ('error' in r) return setError(r.error)
      setError(null)
      setDone(r.tag)
      router.refresh()
    })

  const reason = !admin ? 'Only an Admin can ship a release.' : !n ? 'No done Tickets are waiting for a release.' : !VERSION.test(version) ? 'Enter a version like 0.2.0.' : undefined
  return (
    <>
      <NextStepBar
        sentence={done ? `Shipped ${done}.` : n ? `${n} done ${n === 1 ? 'Ticket waits' : 'Tickets wait'} for a release.` : 'Nothing waits for a release.'}
        primary={{ label: `Ship v${version} (${n} ${n === 1 ? 'Ticket' : 'Tickets'})`, disabled: !!reason || pending, reason: reason ?? undefined, onClick: ship, confirm: `Confirm ship v${version}` }}
      />
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <section className="flex flex-col gap-3" aria-labelledby="waiting">
        <h2 className="heading" id="waiting">Waiting for a release</h2>
        {tickets.length ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {tickets.map((t) => (
              <li key={t.id}>
                <label className="flex items-center gap-3">
                  <Checkbox checked={picked.has(t.id)} disabled={!admin} onChange={() => toggle(t.id)} />
                  <span>{t.title}</span>
                  <span className="label text-muted-foreground">{t.kind}</span>
                  <span className="mono small text-muted-foreground">#{t.number}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : <p className="small text-muted-foreground">Every done Ticket is in a release.</p>}
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="draft">
        <h2 className="heading" id="draft">This release</h2>
        <div className="flex max-w-xs flex-col gap-1">
          <span className="small font-medium text-foreground" id="version-label">Version</span>
          <Select value={version} onValueChange={setVersion} disabled={!admin}>
            <SelectTrigger aria-labelledby="version-label" className="mono"><SelectValue /></SelectTrigger>
            <SelectContent>{versions.map((v) => <SelectItem key={v} value={v} className="mono">{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <label className="flex flex-col gap-1">
          <span className="small font-medium text-foreground">Summary</span>
          <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} disabled={!admin} rows={3} className="max-w-[80ch]" />
        </label>
        {admin && <div><Button type="button" variant="outline" onClick={summarise} disabled={pending || !n}>Summarise</Button></div>}
        <label className="flex flex-col gap-1">
          <span className="small font-medium text-foreground">Release notes</span>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!admin} rows={12} className="mono max-w-[80ch]" />
        </label>
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="past">
        <h2 className="heading" id="past">Past releases</h2>
        {past.length ? past.map((r) => (
          <article key={r.tag} className="flex flex-col gap-2 rounded-md border border-border p-4">
            <h3 className="font-semibold"><a className="text-primary" href={r.url}>{r.tag}</a>{r.at && <span className="small ml-3 font-normal text-muted-foreground">{r.at.slice(0, 10)}</span>}</h3>
            <Markdown html={r.html} />
          </article>
        )) : <p className="small text-muted-foreground">No release yet.</p>}
      </section>
    </>
  )
}
