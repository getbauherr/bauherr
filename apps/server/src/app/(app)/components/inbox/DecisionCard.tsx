'use client'
import Link from 'next/link'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { DecisionModel, DecisionOption } from '../../lib/inbox-decision'
import { ticketPath } from '../../lib/inbox-entries'
import { canConfirm, initialForm, inputOf, receiptOf, type FormState } from '../../lib/inbox-input'
import { paper } from '../assistant-ui/elements/surfaces'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { CriteriaPicker, NoteField, OpenAnswers } from './DecisionParts'
import { Receipt } from './Receipt'
import type { Pending } from './use-pending-decisions'

const VARIANT = { primary: 'default', secondary: 'outline', ghost: 'ghost' } as const

type Props = { model: DecisionModel; pending: Pending }

const labelOf = (option: DecisionOption, form: FormState): string => {
  if (option.criteria) {
    const noun = form.ticked.length === 1 ? 'criterion' : 'criteria'
    return `Drop ${noun} ${form.ticked.join(', ')}`.trim()
  }
  return option.note && !option.note.required ? `${option.label}…` : option.label
}

type Form = { form: FormState; setForm: (next: FormState) => void }

function Reason({ form, setForm }: Form) {
  const [shown, setShown] = useState(false)
  if (!shown) {
    return (
      <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={() => setShown(true)}>
        Add a reason…
      </Button>
    )
  }
  return (
    <Input
      autoFocus
      aria-label="Reason"
      value={form.note}
      placeholder="Reason"
      onChange={(event) => setForm({ ...form, note: event.target.value })}
    />
  )
}

type ActionsProps = {
  model: DecisionModel
  form: FormState
  expanded: DecisionOption | undefined
  onPress: (option: DecisionOption) => void
  onCancel: () => void
}

function Actions({ model, form, expanded, onPress, onCancel }: ActionsProps) {
  if (expanded) {
    return (
      <>
        <Button disabled={!canConfirm(expanded, form)} onClick={() => onPress(expanded)}>
          {expanded.label}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </>
    )
  }
  return model.options.map((option) => (
    <Button
      key={option.choice}
      variant={VARIANT[option.tier]}
      disabled={option.criteria && !canConfirm(option, form)}
      onClick={() => onPress(option)}
    >
      {labelOf(option, form)}
    </Button>
  ))
}

function Heading({ model }: { model: DecisionModel }) {
  const primary = model.options.find((option) => option.tier === 'primary')
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={ticketPath(model.recordId)} className="mono text-muted-foreground hover:underline">
          #{model.number}
        </Link>
        {primary && <Badge variant="accent">Recommended: {primary.label}</Badge>}
      </div>
      <h2 className="m-0 text-xl leading-tight font-bold">{model.headline}</h2>
      <p className="small text-muted-foreground m-0 line-clamp-2">{model.reason}</p>
    </>
  )
}

export function DecisionCard({ model, pending }: Props) {
  const [form, setForm] = useState<FormState>(() => initialForm(model))
  const [open, setOpen] = useState<string | null>(null)
  const staged = pending.staged[model.key]
  if (staged) {
    const { recordId, number, key } = model
    return <Receipt staged={staged} recordId={recordId} number={number} onUndo={() => pending.undo(key)} />
  }
  const expanded = model.options.find((option) => option.choice === open)
  const send = (option: DecisionOption) =>
    pending.stage({
      key: model.key,
      recordId: model.recordId,
      number: model.number,
      receipt: receiptOf(option, form.ticked),
      input: inputOf(model, option, form),
    })
  const press = (option: DecisionOption) => {
    const asksNote = option.note !== null && !option.criteria && open !== option.choice
    if (asksNote) setOpen(option.choice)
    else send(option)
  }
  return (
    <div className={cn(paper, 'flex w-full max-w-lg flex-col gap-4 rounded-[20px] p-5')}>
      <Heading model={model} />
      <OpenAnswers
        answers={model.answers}
        chosen={form.answers}
        onChange={(id, to) => setForm({ ...form, answers: { ...form.answers, [id]: to } })}
      />
      {model.criteria && (
        <>
          <CriteriaPicker
            criteria={model.criteria}
            ticked={form.ticked}
            onChange={(ticked) => setForm({ ...form, ticked })}
          />
          <Reason form={form} setForm={setForm} />
        </>
      )}
      {expanded?.note && (
        <NoteField spec={expanded.note} value={form.note} onChange={(note) => setForm({ ...form, note })} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Actions model={model} form={form} expanded={expanded} onPress={press} onCancel={() => setOpen(null)} />
      </div>
    </div>
  )
}
