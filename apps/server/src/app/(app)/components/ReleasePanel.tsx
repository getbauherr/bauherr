'use client'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { previewRelease, shipReleaseAction } from '../(shell)/releases/actions'
import { Markdown } from './Markdown'
import { NextStepBar } from './NextStepBar'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'

type Row = { id: number; number: number; title: string; kind: string }
type Past = { tag: string; url: string; at: string | null; html: string }

const VERSION = /^\d+\.\d+\.\d+(-rc\.\d+)?$/

/** Tickets waiting for a release (ticked), the proposed version and notes (both editable), the ship button in the next-step bar, and the past releases. */
export function ReleasePanel({ product, admin, tickets, version: v0, notes: n0, past }: { product: number; admin: boolean; tickets: Row[]; version: string; notes: string; past: Past[] }) {
  const router = useRouter()
  const [picked, setPicked] = useState(() => new Set(tickets.map((t) => t.id)))
  const [version, setVersion] = useState(v0)
  const [notes, setNotes] = useState(n0)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const generated = useRef({ version: v0, notes: n0 })
  const n = picked.size

  const toggle = (id: number) => {
    const next = new Set(picked)
    next.has(id) ? next.delete(id) : next.add(id)
    setPicked(next)
    start(async () => {
      const r = await previewRelease({ product, ids: [...next] })
      if ('error' in r) return setError(r.error)
      setError(null)
      if (version === generated.current.version) setVersion(r.version)
      if (notes === generated.current.notes) setNotes(r.notes)
      generated.current = r
    })
  }
  const ship = () =>
    start(async () => {
      const r = await shipReleaseAction({ product, ids: [...picked], version, notes })
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
                  <input type="checkbox" checked={picked.has(t.id)} disabled={!admin} onChange={() => toggle(t.id)} />
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
        <label className="flex max-w-xs flex-col gap-1">
          <span className="small label-strong">Version</span>
          <Input value={version} onChange={(e) => setVersion(e.target.value.trim())} disabled={!admin} className="mono" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="small label-strong">Release notes</span>
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
