'use client'
import { useState, type FC, type ReactNode } from 'react'
import { X } from '@/components/icons'
import { cn } from '@/lib/utils'
import type { CardData } from '../../../../lib/intake/card'
import { KINDS, KIND_HELP, KIND_LABEL, PROBLEM, WHERE, type Kind } from '../../../../lib/intake/kinds'
import type { CardPatch } from '../../../../lib/request-conversation'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Textarea } from '../ui/textarea'

const MARK = 'rounded-xs bg-accent px-0.5 text-foreground underline decoration-primary decoration-2 underline-offset-2'
const mark = (on: boolean, children: ReactNode): ReactNode => (on ? <mark className={MARK}>{children}</mark> : children)

type Editor = { label: string; value: string; max: number; lines?: boolean; onSave(v: string): Promise<boolean> }

/**
 * One line of the card: its label, its value or a dashed placeholder for what the conversation has not filled in yet, and the field's own action. `action` is a button of its own
 * ("Change"); `editor` makes the line editable by hand: "Edit" opens a text box in place of the value (`lines`: one item per line). The agent keeps what the person edited.
 */
const Row: FC<{ field: string; label: string; changed?: boolean; waiting?: string; action?: ReactNode; editor?: Editor | null; busy?: boolean; children?: ReactNode }> = ({ field, label, changed, waiting, action, editor, busy, children }) => {
  const [text, setText] = useState<string | null>(null)
  return (
    <div data-testid="card-field" data-field={field} data-changed={changed || undefined} data-placeholder={waiting ? '' : undefined} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b border-border py-3 text-[14px] last:border-b-0 max-sm:grid-cols-[minmax(0,1fr)_auto]">
      <span className="pt-0.5 text-[13px] text-muted-foreground max-sm:col-span-2">{label}</span>
      <div className="min-w-0 leading-6 wrap-anywhere">
        {editor && text !== null ? (
          <div className="flex flex-col gap-2" data-testid="card-edit">
            <Textarea aria-label={editor.label} autoFocus value={text} maxLength={editor.lines ? undefined : editor.max} className="min-h-20" onChange={(e) => setText(e.target.value)} />
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={async () => (await editor.onSave(text)) && setText(null)}>Save</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setText(null)}>Cancel</Button>
            </div>
          </div>
        ) : waiting ? (
          <p className="m-0 rounded-md border border-dashed border-border px-3 py-1.5 text-muted-foreground">{waiting}</p>
        ) : (
          children
        )}
      </div>
      <div className="flex shrink-0 items-center">
        {action}
        {editor && text === null && <Button type="button" variant="ghost" size="sm" disabled={busy} className="h-7 px-2 text-primary" aria-label={`Edit ${editor.label}`} onClick={() => setText(editor.value)}>Edit</Button>}
      </div>
    </div>
  )
}

/**
 * The living request card (the artifact of request drafting): what the team will get, as the conversation has shaped it. Fields the last turn changed are marked, what is still needed
 * is a dashed placeholder, and every field can be corrected by hand (the agent keeps the person's words). Reads the card only; every edit goes through `onChange`.
 */
export const RequestArtifact: FC<{ card: CardData; busy: boolean; started: boolean; onChange(patch: CardPatch): Promise<boolean>; onRemoveImage(id: number): void }> = ({ card, busy, started, onChange, onRemoveImage }) => {
  const live = card.editable
  const changed = (f: string) => live && card.changed.includes(f)
  const needs = (f: string) => card.needs.includes(f)
  const lines = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean)
  const fast = card.kind === 'bug' && card.fastLane && !card.split
  const urgent = card.urgency === 'urgent'
  const edit = (label: string, value: string, max: number, patch: (v: string) => CardPatch, multi = false): Editor | null => (live ? { label, value, max, lines: multi, onSave: (v) => onChange(patch(v)) } : null)
  return (
    <div data-testid="request-card" data-kind={card.kind} data-urgency={card.urgency} data-state={card.sent ? 'sent' : 'draft'} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[20px] leading-7 font-semibold">{card.sent ? 'Request' : 'New request'}</h2>
        <Badge variant="neutral" data-testid="card-kind">{KIND_LABEL[card.kind]}</Badge>
        {urgent && <Badge variant="destructive" data-testid="card-urgent">Urgent</Badge>}
        {card.followUp && <Badge variant="neutral">Follow-up to #{card.followUp}</Badge>}
      </div>
      {live && card.changed.length > 0 && <p className="m-0 flex items-center gap-1.5 text-[13px] text-muted-foreground" data-testid="legend"><mark className={MARK}>Highlighted</mark>= filled in from your last message</p>}
      <div className="flex flex-col">
        <Row field="title" label="Title" changed={changed('title')} waiting={card.title ? undefined : 'Waiting for your first message'} editor={edit('Title', card.title, 80, (title) => ({ title }))} busy={busy}>
          {mark(changed('title'), card.title)}
        </Row>
        <Row field="type" label="Type" changed={changed('type')}>
          {live ? (
            <Select value={card.kind} onValueChange={(v) => void onChange({ type: v as Kind })} disabled={busy}>
              <SelectTrigger aria-label="Type" className="h-8 w-fit min-w-32"><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
            </Select>
          ) : mark(changed('type'), KIND_LABEL[card.kind])}
          {live && <p className="m-0 mt-1 text-[12px] leading-4 text-muted-foreground">{KIND_HELP[card.kind]}</p>}
        </Row>
        <Row field="product" label="Product">
          {live && !started && card.productChoices.length > 1 ? (
            <Select value={String(card.product?.id ?? '')} onValueChange={(v) => void onChange({ product: Number(v) })} disabled={busy}>
              <SelectTrigger aria-label="Product" className="h-8 w-fit min-w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{card.productChoices.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          ) : card.product?.name ?? '—'}
        </Row>
        {(fast || urgent) && (
          <Row field="urgency" label="Urgency" changed={changed('urgency')} busy={busy} action={live && fast ? <Button type="button" variant="ghost" size="sm" disabled={busy} className="h-7 px-2 text-primary" onClick={() => void onChange({ urgency: urgent ? 'normal' : 'urgent' })}>Change</Button> : undefined}>
            <span className="flex flex-wrap items-center gap-2">{urgent ? <Badge variant="destructive">Urgent</Badge> : <Badge variant="neutral">Normal</Badge>}{urgent && <span className="text-[13px] text-muted-foreground">asks the Bauherr for the fast lane</span>}</span>
          </Row>
        )}
        {urgent && (
          <Row field="urgent_reason" label="Why urgent" changed={changed('urgent_reason')} waiting={needs('urgent_reason') ? 'Waiting for your answer: what is broken, for whom, since when' : undefined} editor={edit('Why urgent', card.urgentReason, 500, (urgent_reason) => ({ urgent_reason }))} busy={busy}>
            {mark(changed('urgent_reason'), card.urgentReason)}
          </Row>
        )}
        {card.parts > 1 && (
          <Row field="items" label="Requests" changed={changed('problem')}>
            <ol className="m-0 flex list-decimal flex-col gap-1 pl-5" data-testid="card-items">{card.items.map((i) => <li key={i}>{mark(changed('problem'), i)}</li>)}</ol>
          </Row>
        )}
        {card.parts <= 1 && <Row field="problem" label={PROBLEM[card.kind]} changed={changed('problem')} waiting={needs('problem') ? 'Waiting for your answer' : undefined} editor={edit(PROBLEM[card.kind], card.problem, 1000, (problem) => ({ problem }))} busy={busy}>
          <span className="whitespace-pre-line">{mark(changed('problem'), card.problem)}</span>
        </Row>}
        {card.kind !== 'question' && card.parts <= 1 && (
          <Row field="context" label={WHERE[card.kind]} changed={changed('context')} waiting={needs('context') ? 'Waiting for your answer' : card.context ? undefined : 'Optional: anything else the team should know'} editor={edit(WHERE[card.kind], card.context, 2000, (context) => ({ context }))} busy={busy}>
            <span className="whitespace-pre-line">{mark(changed('context'), card.context)}</span>
          </Row>
        )}
        {card.kind !== 'question' && card.parts <= 1 && (
          <Row field="acceptance_criteria" label="Done when" changed={changed('acceptance_criteria')} waiting={card.criteria.length ? undefined : 'Waiting for your answer'} editor={edit('Done when', card.criteria.join('\n'), 0, (v) => ({ acceptance_criteria: lines(v) }), true)} busy={busy}>
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5">{card.criteria.map((c) => <li key={c}>{mark(changed('acceptance_criteria'), c)}</li>)}</ul>
          </Row>
        )}
        {card.kind !== 'question' && (card.images.length > 0 || needs('screenshot') || live) && (
          <Row field="attachments" label="Attachments" waiting={card.images.length ? undefined : needs('screenshot') ? 'Waiting for a screenshot: attach one in the message box' : 'None. Attach a screenshot in the message box if it helps'}>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="card-images">
              {card.images.map((m) => (
                <li key={m.id} className="relative size-16 overflow-hidden rounded-md border border-border bg-secondary">
                  <a href={m.url} target="_blank" rel="noreferrer" aria-label={`Open ${m.name}`}><img src={m.url} alt={m.name} className="size-full object-cover" /></a>
                  {live && <button type="button" aria-label={`Remove ${m.name}`} disabled={busy} className={cn('absolute top-0.5 right-0.5 rounded-full bg-background/90 p-0.5 text-muted-foreground hover:text-foreground')} onClick={() => onRemoveImage(m.id)}><X className="size-3" /></button>}
                </li>
              ))}
            </ul>
          </Row>
        )}
      </div>
    </div>
  )
}
