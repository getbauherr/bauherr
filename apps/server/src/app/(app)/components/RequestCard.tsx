'use client'
import Link from 'next/link'
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FC } from 'react'
import { Button } from '@/components/ui/button'
import { X } from '@/components/icons'
import { cn } from '@/lib/utils'
import type { CardData } from '../../../lib/intake/card'
import { KIND_HELP, KIND_LABEL } from '../../../lib/intake/kinds'
import { KINDS, type Kind } from '../../../lib/intake/kinds'
import { changeRequestImage, editRequestCard } from '../lib/actions'
import { Badge } from './ui/badge'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Textarea } from './ui/textarea'

/** Fired when a card changed (an edit, an image) so the card in the dock and the one on the page reload. */
export const CARD_CHANGED = 'request-card-changed'
const changed = (session: number) => dispatchEvent(new CustomEvent<number>(CARD_CHANGED, { detail: session }))
export const onCardChanged = (session: number, cb: () => void) => {
  const h = (e: Event) => (e as CustomEvent<number>).detail === session && cb()
  addEventListener(CARD_CHANGED, h)
  return () => removeEventListener(CARD_CHANGED, h)
}

const PROBLEM: Record<Kind, string> = { bug: 'What is wrong', feature: 'What is wanted, for whom and why', change: 'What should work differently, for whom and why', question: 'Your question' }
const WHERE: Record<Kind, string> = { bug: 'Where does it happen? Add the steps if you know them', feature: 'Anything else we should know (optional)', change: 'Anything else we should know (optional)', question: '' }
const IMAGE = /^image\/(png|jpeg|webp)$/

const Field: FC<{ id: string; label: string; hint?: string; children: React.ReactNode }> = ({ id, label, hint, children }) => (
  <div className="flex flex-col gap-1">
    <Label htmlFor={id} className="text-[13px]">{label}</Label>
    {children}
    {hint && <p className="m-0 text-[12px] leading-4 text-muted-foreground">{hint}</p>}
  </div>
)

const Read: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[12px] text-muted-foreground">{label}</span>
    <span className="text-[14px] leading-5 wrap-anywhere whitespace-pre-line">{children}</span>
  </div>
)

/** The request card: title, type, product, urgency, what is wrong or wanted, "It is done when" and screenshots. The interview fills it; every field is also editable here (stored at once, and the next turn keeps it). `onSend` makes "Send to the factory" (the confirmation card comes next); without `editable` the card only reads. */
export function RequestCard({ initial, onSend, productSelect = false }: { initial: CardData; onSend?: () => void; productSelect?: boolean }) {
  const [card, setCard] = useState(initial)
  const [form, setForm] = useState({ title: initial.title, problem: initial.problem, context: initial.context, reason: initial.urgentReason, criteria: initial.criteria.join('\n') })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setCard(initial)
    setForm({ title: initial.title, problem: initial.problem, context: initial.context, reason: initial.urgentReason, criteria: initial.criteria.join('\n') })
  }, [initial])
  const id = (n: string) => `card-${card.session}-${n}`
  const take = (r: { card: CardData } | { error: string }) => {
    if ('error' in r) return setError(r.error)
    setError('')
    setCard(r.card)
    setForm({ title: r.card.title, problem: r.card.problem, context: r.card.context, reason: r.card.urgentReason, criteria: r.card.criteria.join('\n') })
    changed(card.session)
  }
  const save = async (patch: Parameters<typeof editRequestCard>[1]) => {
    setBusy(true)
    try {
      take(await editRequestCard(card.session, patch))
    } finally {
      setBusy(false)
    }
  }
  const upload = async (files: File[]) => {
    setBusy(true)
    setError('')
    try {
      for (const f of files.filter((f) => IMAGE.test(f.type))) {
        const body = new FormData()
        body.append('file', f)
        const r = await fetch('/api/chat/media', { method: 'POST', body })
        const data = (await r.json().catch(() => ({}))) as { id?: number; error?: string }
        if (!r.ok || !data.id) return setError(data.error ?? 'Could not upload the image.')
        take(await changeRequestImage(card.session, data.id, 'add'))
      }
    } finally {
      setBusy(false)
    }
  }
  const lines = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean)
  const editable = card.editable
  const urgentWhy = !card.fastLane ? 'The fast lane is off for this Workspace, so nothing can be marked urgent.' : card.kind !== 'bug' ? 'Only a bug can be urgent.' : card.split ? 'An urgent request is sent alone.' : null
  const pasted = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter((f) => IMAGE.test(f.type))
    if (!files.length) return
    e.preventDefault()
    void upload(files)
  }
  const dropped = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    void upload(Array.from(e.dataTransfer.files))
  }
  const send = card.sent ? null : card.kind === 'question' ? (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[13px] text-muted-foreground">A question is answered in the chat and files nothing.</p>
      <Button type="button" size="sm" variant="outline" className="self-start" disabled={busy} onClick={() => void save({ type: 'feature' })}>Turn into a request</Button>
    </div>
  ) : (
    <div className="flex flex-col gap-2">
      <Button type="button" size="sm" className="self-start" disabled={busy || !card.canSend} onClick={onSend} data-testid="card-send">Send to the factory</Button>
      <p className="m-0 text-[13px] text-muted-foreground" data-testid="card-missing">{card.missing.length ? `${card.canSend ? 'Can be sent. Still open' : 'Missing'}: ${card.missing.join(', ')}.` : 'Ready to send.'}</p>
    </div>
  )

  return (
    <section aria-label="Request card" data-testid="request-card" data-kind={card.kind} data-urgency={card.urgency} data-state={card.sent ? 'sent' : editable ? 'draft' : 'read'} className={cn('flex flex-col gap-3 rounded-md border bg-card p-3 text-card-foreground', over && 'border-primary')} onPaste={editable ? pasted : undefined} onDragOver={editable ? (e) => { e.preventDefault(); setOver(true) } : undefined} onDragLeave={() => setOver(false)} onDrop={editable ? dropped : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="accent" data-testid="card-kind">{KIND_LABEL[card.kind]}</Badge>
        {card.urgency === 'urgent' && <Badge variant="destructive" data-testid="card-urgent">Urgent</Badge>}
        {card.followUp && <Badge variant="neutral">Follow-up to #{card.followUp}</Badge>}
        {card.sent && <Badge variant="ok">Sent</Badge>}
        {busy && <span className="text-[12px] text-muted-foreground" role="status">Saving...</span>}
      </div>
      {editable ? (
        <>
          <Field id={id('title')} label="Title">
            <Input id={id('title')} value={form.title} maxLength={80} placeholder="A short title" onChange={(e) => setForm({ ...form, title: e.target.value })} onBlur={() => form.title !== card.title && void save({ title: form.title })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={id('kind')} label="Type" hint={KIND_HELP[card.kind]}>
              <Select value={card.kind} onValueChange={(v) => void save({ type: v as Kind })} disabled={busy}>
                <SelectTrigger id={id('kind')} aria-label="Type"><SelectValue /></SelectTrigger>
                <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field id={id('product')} label="Product" hint={card.product && !card.productChoices.length ? 'Fixed once the conversation has started.' : undefined}>
              {productSelect && card.productChoices.length > 1 ? (
                <Select value={String(card.product?.id ?? '')} onValueChange={(v) => void save({ product: Number(v) })} disabled={busy}>
                  <SelectTrigger id={id('product')} aria-label="Product"><SelectValue /></SelectTrigger>
                  <SelectContent>{card.productChoices.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <span className="flex h-9 items-center text-[15px]" id={id('product')}>{card.product?.name ?? '—'}</span>
              )}
            </Field>
          </div>
          <Field id={id('urgency')} label="Urgency" hint={urgentWhy ?? undefined}>
            <Select value={card.urgency} onValueChange={(v) => void save({ urgency: v as 'normal' | 'urgent' })} disabled={busy || (!!urgentWhy && card.urgency === 'normal')}>
              <SelectTrigger id={id('urgency')} aria-label="Urgency"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="urgent" disabled={!!urgentWhy}>Urgent: something is broken for users now</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {card.urgency === 'urgent' && (
            <Field id={id('reason')} label="What is broken, for whom, since when" hint="The Bauherr reads this when deciding on the fast lane.">
              <Textarea id={id('reason')} className="min-h-16" value={form.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })} onBlur={() => form.reason !== card.urgentReason && void save({ urgent_reason: form.reason })} />
            </Field>
          )}
          <Field id={id('problem')} label={PROBLEM[card.kind]}>
            <Textarea id={id('problem')} className="min-h-20" value={form.problem} maxLength={1000} onChange={(e) => setForm({ ...form, problem: e.target.value })} onBlur={() => form.problem !== card.problem && void save({ problem: form.problem })} />
          </Field>
          {card.kind !== 'question' && (
            <>
              <Field id={id('context')} label={WHERE[card.kind]}>
                <Textarea id={id('context')} className="min-h-16" value={form.context} maxLength={2000} onChange={(e) => setForm({ ...form, context: e.target.value })} onBlur={() => form.context !== card.context && void save({ context: form.context })} />
              </Field>
              <Field id={id('criteria')} label="It is done when" hint="One line for each thing that must be true.">
                <Textarea id={id('criteria')} className="min-h-16" value={form.criteria} onChange={(e) => setForm({ ...form, criteria: e.target.value })} onBlur={() => form.criteria !== card.criteria.join('\n') && void save({ acceptance_criteria: lines(form.criteria) })} />
              </Field>
            </>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2" data-testid="card-read">
          <Read label="Title">{card.title || 'Untitled request'}</Read>
          <Read label="Product">{card.product?.name ?? '—'}</Read>
          {card.urgency === 'urgent' && <Read label="Urgent: what is broken, for whom, since when">{card.urgentReason}</Read>}
          <Read label={PROBLEM[card.kind]}>{card.problem || '—'}</Read>
          {card.kind !== 'question' && card.context && <Read label={WHERE[card.kind].replace(' (optional)', '')}>{card.context}</Read>}
          {card.kind !== 'question' && !!card.criteria.length && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[12px] text-muted-foreground">It is done when</span>
              <ul className="m-0 pl-5 text-[14px] leading-5">{card.criteria.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {(editable || !!card.images.length) && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Screenshots</span>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0 empty:hidden" data-testid="card-images">
            {card.images.map((m) => (
              <li key={m.id} className="relative size-16 overflow-hidden rounded-md border bg-secondary">
                <a href={m.url} target="_blank" rel="noreferrer" aria-label={`Open ${m.name}`}><img src={m.url} alt={m.name} className="size-full object-cover" /></a>
                {editable && <button type="button" aria-label={`Remove ${m.name}`} className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 text-muted-foreground hover:text-foreground" onClick={async () => take(await changeRequestImage(card.session, m.id, 'remove'))}><X /></button>}
              </li>
            ))}
          </ul>
          {editable && (
            <>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="Choose screenshots" onChange={(e) => { void upload(Array.from(e.target.files ?? [])); e.target.value = '' }} />
              <Button type="button" size="sm" variant="outline" className="self-start" disabled={busy || card.images.length >= card.maxImages} onClick={() => file.current?.click()}>Add a screenshot</Button>
              <p className="m-0 text-[12px] text-muted-foreground">Paste, drop or pick up to {card.maxImages} images.</p>
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="m-0 text-[13px] text-destructive">{error}</p>}
      {editable && send}
      {card.sent && card.ticket && <p className="m-0 text-[13px] text-muted-foreground">Filed as <Link className="text-primary" href={`/requests/${card.session}`}>#{card.ticket}</Link>.</p>}
    </section>
  )
}
