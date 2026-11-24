'use client'
import { useContext, useEffect, useId, useRef, useState } from 'react'
import { describedBy, Field, FieldError, FieldHint, type Opt } from './SettingsField'
import { FormStateContext } from './SettingsFormState'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

const OTHER = '__other'
const NONE = '__none'

function PickerSelect({
  uid,
  options,
  empty,
  choice,
  setChoice,
  error,
  described,
}: {
  uid: string
  options: Opt[]
  empty?: string
  choice: string
  setChoice: (value: string) => void
  error?: string
  described?: string
}) {
  return (
    <Select value={choice === '' ? NONE : choice} onValueChange={(v) => setChoice(v === NONE ? '' : v)}>
      <SelectTrigger id={uid} aria-invalid={!!error || undefined} aria-describedby={described}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {empty !== undefined && <SelectItem value={NONE}>{empty}</SelectItem>}
        {options.map((o) => {
          const [v, l] = Array.isArray(o) ? o : [o, o]
          return (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          )
        })}
        <SelectItem value={OTHER}>Other...</SelectItem>
      </SelectContent>
    </Select>
  )
}

function usePicker(options: Opt[], defaultValue: string, empty?: string) {
  const values = options.map((o) => (Array.isArray(o) ? o[0] : o))
  const known = values.includes(defaultValue) || (!defaultValue && empty !== undefined)
  const start = known ? defaultValue : defaultValue ? OTHER : (values[0] ?? '')
  const [choice, setChoice] = useState(start)
  const [typed, setTyped] = useState(known ? '' : defaultValue)
  const hidden = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const form = hidden.current?.form
    const back = () => (setChoice(start), setTyped(known ? '' : defaultValue))
    form?.addEventListener('reset', back)
    return () => form?.removeEventListener('reset', back)
  }, [start, known, defaultValue])
  return { choice, setChoice, typed, setTyped, hidden }
}

function Picker({
  name,
  label,
  options,
  defaultValue,
  empty,
  hint,
  example,
  required,
}: {
  name: string
  label: string
  options: Opt[]
  defaultValue: string
  empty?: string
  hint?: string
  example?: string
  required?: boolean
}) {
  const error = useContext(FormStateContext).fields?.[name]
  const uid = useId()
  const { choice, setChoice, typed, setTyped, hidden } = usePicker(options, defaultValue, empty)
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={uid} className="small">
        {label}
      </Label>
      {hint && <FieldHint id={`${uid}-h`}>{hint}</FieldHint>}
      <input ref={hidden} type="hidden" name={name} value={choice === OTHER ? typed : choice} />
      <PickerSelect
        uid={uid}
        options={options}
        empty={empty}
        choice={choice}
        setChoice={(v) => {
          setChoice(v)
          hidden.current?.dispatchEvent(new Event('change', { bubbles: true }))
        }}
        error={error}
        described={describedBy(uid, [hint && 'h', error && 'e'])}
      />
      {choice === OTHER && (
        <Input
          aria-label={`${label}, other`}
          placeholder={example}
          value={typed}
          required={required}
          aria-invalid={!!error || undefined}
          onChange={(e) => setTyped(e.target.value)}
        />
      )}
      {error && <FieldError id={`${uid}-e`}>{error}</FieldError>}
    </div>
  )
}

export function PickField({
  options,
  empty,
  defaultValue = '',
  ...rest
}: {
  name: string
  label: string
  options: Opt[] | null
  defaultValue?: string
  empty?: string
  hint?: string
  example?: string
  placeholder?: string
  required?: boolean
}) {
  return options?.length ? (
    <Picker {...rest} options={options} empty={empty} defaultValue={defaultValue} />
  ) : (
    <Field {...rest} defaultValue={defaultValue} />
  )
}

export function Checks({
  name,
  items,
  checked,
}: {
  name: string
  items: { id: number; label: string }[]
  checked: number[]
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="small p-0 text-muted-foreground">Workspaces</legend>
      {items.map((i) => (
        <label key={i.id} className="flex items-center gap-2">
          <Checkbox name={name} value={i.id} defaultChecked={checked.includes(i.id)} />
          {i.label}
        </label>
      ))}
    </fieldset>
  )
}
