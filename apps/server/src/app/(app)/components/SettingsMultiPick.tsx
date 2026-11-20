'use client'
import { useContext, useId, useState } from 'react'
import { FieldError } from './SettingsField'
import { FormStateContext } from './SettingsFormState'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'

export type PickOption = { value: string; label?: string; meta?: string }

type Chosen = {
  items: PickOption[]
  checked: Set<string>
  draft: string
  setDraft: (value: string) => void
  toggle: (value: string, on: boolean) => void
  add: () => void
}

function useMultiPick(options: PickOption[], value: string[], missingMeta: string, login?: boolean): Chosen {
  const [items, setItems] = useState<PickOption[]>(() => [
    ...options,
    ...value.filter((v) => !options.some((o) => o.value === v)).map((v) => ({ value: v, meta: missingMeta })),
  ])
  const [checked, setChecked] = useState(() => new Set(value))
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft
      .replace(/,/g, '')
      .trim()
      .replace(login ? /^@/ : /^$/, '')
    if (!v) return
    if (!items.some((i) => i.value === v)) setItems((all) => [...all, { value: v, meta: 'added by hand' }])
    setChecked((c) => new Set(c).add(v))
    setDraft('')
  }
  const toggle = (v: string, on: boolean) =>
    setChecked((c) => {
      const n = new Set(c)
      if (on) n.add(v)
      else n.delete(v)
      return n
    })
  return { items, checked, draft, setDraft, toggle, add }
}

function PickItem({
  item,
  chosen,
  mono,
}: {
  item: PickOption
  chosen: Pick<Chosen, 'checked' | 'toggle'>
  mono: boolean
}) {
  return (
    <label className="flex items-center gap-2">
      <Checkbox
        checked={chosen.checked.has(item.value)}
        onChange={(e) => chosen.toggle(item.value, e.target.checked)}
      />
      <span className="flex min-w-0 flex-col gap-1">
        <span className={mono ? 'mono wrap-anywhere' : 'wrap-anywhere'}>{item.label ?? item.value}</span>
        {item.meta && <span className="small text-muted-foreground">{item.meta}</span>}
      </span>
    </label>
  )
}

function AddRow({
  label,
  example,
  chosen,
  invalid,
}: {
  label: string
  example?: string
  chosen: Pick<Chosen, 'draft' | 'setDraft' | 'add'>
  invalid: boolean
}) {
  const { draft, setDraft, add } = chosen
  return (
    <div className="flex gap-2">
      <Input
        aria-label={label}
        placeholder={example}
        value={draft}
        aria-invalid={invalid || undefined}
        className="min-w-0 flex-1"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }}
      />
      <Button type="button" variant="outline" onClick={add}>
        Add
      </Button>
    </div>
  )
}

export function MultiPick({
  name,
  legend,
  hint,
  options,
  value,
  addLabel,
  example,
  missingMeta,
  emptyNote,
  notice,
  login,
  mono = true,
  disabled,
}: {
  name: string
  legend: string
  hint?: string
  options: PickOption[]
  value: string[]
  addLabel: string
  example?: string
  missingMeta: string
  emptyNote?: string
  notice?: string
  login?: boolean
  mono?: boolean
  disabled?: boolean
}) {
  const error = useContext(FormStateContext).fields?.[name]
  const uid = useId()
  const chosen = useMultiPick(options, value, missingMeta, login)
  const { items, checked } = chosen
  return (
    <fieldset
      className="m-0 flex flex-col gap-2 border-0 p-0"
      disabled={disabled}
      aria-describedby={error ? `${uid}-e` : undefined}
    >
      <legend className="small p-0 font-medium text-foreground">{legend}</legend>
      {hint && <span className="small text-muted-foreground">{hint}</span>}
      <input
        type="hidden"
        name={name}
        value={items
          .filter((i) => checked.has(i.value))
          .map((i) => i.value)
          .join(',')}
      />
      {items.map((i) => (
        <PickItem key={i.value} item={i} chosen={chosen} mono={mono} />
      ))}
      {notice && <span className="small text-muted-foreground">{notice}</span>}
      {!checked.size && emptyNote && <span className="small text-muted-foreground">{emptyNote}</span>}
      <AddRow label={addLabel} example={example} chosen={chosen} invalid={!!error} />
      {error && <FieldError id={`${uid}-e`}>{error}</FieldError>}
    </fieldset>
  )
}
