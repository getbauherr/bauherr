'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { Decision, DecisionOption } from '../../../lib/decision'
import { decideAction } from '../lib/actions'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Textarea } from './ui/textarea'
import { DockOpen } from './chat/DockOpen'
import { Markdown } from './Markdown'

export type DecisionView = { id: number; number: number; decision: Decision; detailsHtml: string | null; waiting: string; product?: string }

const external = (url: string) => /^https?:\/\//.test(url)

/**
 * One human checkpoint, prepared the same way everywhere: the ask first, one recommendation line, at most three facts, then the buttons.
 * `compact` (Ticket page) leaves the buttons to the next-step bar; the full card (Inbox) runs the option's existing action in place and leaves the list.
 */
export function DecisionCard({ item, compact, admin = true, onDecided, onFailed }: { item: DecisionView; compact?: boolean; admin?: boolean; onDecided?: (id: number) => void; onFailed?: (id: number) => void }) {
  const d = item.decision
  const router = useRouter()
  const [pending, start] = useTransition()
  const [asking, setAsking] = useState<DecisionOption | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const run = (o: DecisionOption, text = '') => {
    setError(null)
    setAsking(null)
    setGone(true)
    onDecided?.(item.id)
    start(async () => {
      const r = await decideAction(item.id, d.need, o.action, text, o.outcome)
      if (r.error) {
        setError(r.error)
        setGone(false)
        onFailed?.(item.id)
      } else router.refresh()
    })
  }
  const click = (o: DecisionOption) => {
    if (o.note || o.destructive) {
      setNote('')
      setAsking(o)
    } else run(o)
  }
  const evidence = d.evidence.filter((e) => admin || !e.url.startsWith('/runs/'))
  return (
    <Card asChild className={`gap-3 p-5 max-sm:p-4${gone ? ' hidden' : ''}`}>
      <article id={`t${item.id}`} tabIndex={0} data-decision={item.id} aria-labelledby={`ask-${item.id}`} className="scroll-mt-20 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {!compact && (
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge variant="accent">{d.checkpoint}</Badge>
            <span className="small text-muted-foreground">{item.waiting}</span>
            <Link href={`/tickets/${item.id}`} className="small ml-auto min-w-0 truncate text-muted-foreground hover:text-foreground max-sm:ml-0 max-sm:basis-full">
              #{item.number} {d.title}{item.product ? ` · ${item.product}` : ''}
            </Link>
          </header>
        )}
        <h2 id={`ask-${item.id}`} className={compact ? 'sr-only' : 'm-0 text-[19px] leading-snug font-semibold text-balance'}>{d.ask}</h2>
        {d.recommendation && (
          <p className="body m-0 max-w-none text-pretty">
            <span className="font-medium text-primary">Recommended </span>
            {d.recommendation}
          </p>
        )}
        {d.why.length > 0 && (
          <ul className="small m-0 flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
            {d.why.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
        {(evidence.length > 0) && (
          <div className="small flex flex-wrap items-center gap-x-4 gap-y-1">
            {evidence.map((e) => <a key={e.url} className="text-primary" href={e.url} {...(external(e.url) ? { target: '_blank', rel: 'noreferrer' } : {})}>{e.label}</a>)}
          </div>
        )}
        {item.detailsHtml && !compact && (
          <details className="small group">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Details</summary>
            <Markdown html={item.detailsHtml} className="small mt-2" />
          </details>
        )}
        {compact && <p className="small m-0 text-muted-foreground">Then: {d.next}</p>}
        {!compact && (
          <footer className="mt-1 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {d.options.map((o) =>
                o.action === 'open' && o.href?.endsWith('#answer') ? (
                  <DockOpen key={o.label} ticket={item.id} mode="answer" variant={o.primary ? 'default' : 'outline'} title={o.effect}>{o.label}</DockOpen>
                ) : o.action === 'open' ? (
                  <Button key={o.label} asChild variant={o.primary ? 'default' : 'outline'} title={o.effect}>
                    <a href={o.href} {...(o.href && external(o.href) ? { target: '_blank', rel: 'noreferrer' } : {})}>{o.label}</a>
                  </Button>
                ) : (
                  <Button key={o.label} variant={o.primary ? 'default' : 'outline'} className={o.destructive ? 'text-destructive' : undefined} disabled={pending} title={o.effect} onClick={() => click(o)}>{o.label}</Button>
                ),
              )}
              {pending && <span className="small text-muted-foreground" role="status">Working…</span>}
            </div>
            <p className="small m-0 text-muted-foreground">{d.options.find((o) => o.primary)?.effect ?? d.next}</p>
            {error && <p role="alert" className="small m-0 text-destructive">{error}</p>}
          </footer>
        )}
        <Dialog open={!!asking} onOpenChange={(open) => !open && setAsking(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{asking?.label}</DialogTitle>
              <DialogDescription>{asking?.effect}</DialogDescription>
            </DialogHeader>
            {asking?.note && (
              <label className="flex flex-col gap-1">
                <span className="small text-muted-foreground">{asking.note === 'required' ? 'Note (required)' : 'Note (optional)'}</span>
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setAsking(null)}>Cancel</Button>
              <Button variant={asking?.destructive ? 'destructive' : 'default'} disabled={asking?.note === 'required' && !note.trim()} onClick={() => asking && run(asking, note.trim())}>{asking?.label}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </article>
    </Card>
  )
}
