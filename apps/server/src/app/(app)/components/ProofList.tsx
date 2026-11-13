'use client'
import { useRef, useState } from 'react'
import type { ProofData, ProofItem } from '../lib/proof'
import { isWebUrl } from '../lib/url'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

const src = (p: ProofData, i: ProofItem) => `/api/tickets/${p.ticket}/artifacts/${i.id}`
const safeLink = 'min-h-6 py-[3px] text-primary underline-offset-2 hover:underline'

/** Text of a transcript, sample or report: collapsed, always plain text (no HTML, no markdown). */
const Text = ({ item }: { item: ProofItem }) => (
  <details className="small group" data-testid="proof-text">
    <summary className="cursor-pointer text-primary">{item.title}<span className="text-muted-foreground"> · {item.kind}</span></summary>
    <pre className={`mt-1 max-h-72 overflow-auto rounded-sm border border-border bg-secondary p-2 text-[13px] whitespace-pre-wrap break-words ${item.kind === 'report' ? 'font-sans' : 'mono'}`}>{item.text}</pre>
  </details>
)

function Recording({ data, item }: { data: ProofData; item: ProofItem }) {
  const [on, setOn] = useState(false)
  return on ? (
    <video className="max-h-48 max-w-full rounded-sm border border-border" controls autoPlay preload="metadata" src={src(data, item)} aria-label={item.title} />
  ) : (
    <Button type="button" variant="outline" size="sm" onClick={() => setOn(true)} aria-label={`Play ${item.title}`}>Play<span className="sr-only"> {item.title}</span></Button>
  )
}

function Cell({ data, items, open }: { data: ProofData; items: ProofItem[]; open: (i: ProofItem) => void }) {
  const images = items.filter((i) => i.kind === 'image' && i.file)
  const pair = images.some((i) => i.pair === 'before') && images.some((i) => i.pair === 'after')
  const thumb = (i: ProofItem) => (
    <figure key={i.id} className="m-0 flex flex-col gap-1">
      <button type="button" onClick={() => open(i)} className="block cursor-zoom-in rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Enlarge: ${i.title}`}>
        <img className="block h-24 w-auto max-w-full rounded-sm border border-border object-cover" src={src(data, i)} alt={i.title} loading="lazy" />
      </button>
      <figcaption className="label text-muted-foreground">{i.pair ? (i.pair === 'before' ? 'Before' : 'After') : i.title}</figcaption>
    </figure>
  )
  return (
    <div className="flex flex-col gap-2">
      {pair ? <div className="flex flex-wrap gap-3" data-testid="proof-pair">{[...images].sort((a, b) => Number(b.pair === 'before') - Number(a.pair === 'before')).map(thumb)}</div> : images.length > 0 && <div className="flex flex-wrap gap-3">{images.map(thumb)}</div>}
      {items.filter((i) => i.kind === 'recording').map((i) => <Recording key={i.id} data={data} item={i} />)}
      {items.filter((i) => i.text && ['transcript', 'sample', 'report'].includes(i.kind)).map((i) => <Text key={i.id} item={i} />)}
    </div>
  )
}

/**
 * What was asked and what proves it: one row per acceptance criterion with its proof (thumbnails, before/after side by side, recordings, collapsed text) and a way to try it (preview links, the Product's staging address).
 * Criteria without proof say so. Used on the Ticket page, the Inbox decision cards and the chat confirm card; it stacks by its own width (container query), not the screen's.
 */
export function ProofList({ data }: { data: ProofData }) {
  const [shown, setShown] = useState<ProofItem | null>(null)
  const opener = useRef<Element | null>(null)
  const open = (i: ProofItem) => {
    opener.current = document.activeElement
    setShown(i)
  }
  return (
    <section className="@container flex min-w-0 flex-col gap-2" aria-label="Proof for review" data-testid="proof-list">
      <h3 className="heading m-0 text-[15px]">Proof</h3>
      <table className="block w-full border-collapse border border-border bg-card text-left @lg:table [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2">
        <thead className="hidden bg-secondary @lg:table-header-group">
          <tr className="label"><th scope="col">What was asked</th><th scope="col">Proof</th><th scope="col">Try it</th></tr>
        </thead>
        <tbody className="block @lg:table-row-group">
          {data.rows.map((r, n) => {
            const previews = r.items.filter((i) => i.kind === 'preview' && isWebUrl(i.url))
            const proof = r.items.filter((i) => i.kind !== 'preview')
            return (
              <tr key={n} className="block border-t border-border first:border-t-0 @lg:table-row" data-testid="proof-row">
                <td className="block text-[15px] @lg:table-cell @lg:w-1/3">{r.criterion ?? <span className="text-muted-foreground">Other proof</span>}</td>
                <td className="block @lg:table-cell">
                  {proof.length ? <Cell data={data} items={proof} open={open} /> : previews.length ? <span className="small text-muted-foreground">See Try it</span> : <Badge variant="warn" data-testid="no-proof">No proof</Badge>}
                </td>
                <td className="small block @lg:table-cell">
                  <div className="flex flex-col gap-1">
                    {previews.map((i) => <a key={i.id} className={safeLink} href={i.url} target="_blank" rel="noopener noreferrer">{i.title}</a>)}
                    {isWebUrl(data.staging) && <a className={safeLink} href={data.staging} target="_blank" rel="noopener noreferrer">Staging</a>}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {data.waived.length > 0 && (
        <ul className="small m-0 flex list-none flex-col gap-1 p-0" data-testid="proof-waived">
          {data.waived.map((w) => <li key={w.rule} className="text-warn">No proof for {w.rule}: {w.reason}</li>)}
        </ul>
      )}
      <Dialog open={!!shown} onOpenChange={(o) => !o && setShown(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-auto sm:max-w-[min(960px,calc(100%-2rem))]" onCloseAutoFocus={(e) => { e.preventDefault(); (opener.current as HTMLElement | null)?.focus() }}>
          <DialogTitle className="pr-8">{shown?.title}</DialogTitle>
          <DialogDescription className="sr-only">Enlarged proof image</DialogDescription>
          {shown && <img className="block h-auto max-w-full rounded-sm border border-border" src={src(data, shown)} alt={shown.title} />}
        </DialogContent>
      </Dialog>
    </section>
  )
}
