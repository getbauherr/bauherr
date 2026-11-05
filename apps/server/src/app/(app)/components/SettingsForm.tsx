'use client'
import { createContext, startTransition, useActionState, useContext, useId, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import type { FormState } from '../lib/settings'
import { NextStepBar } from './NextStepBar'
import { Button } from './ui/button'
import { Input } from './ui/input'

const Ctx = createContext<FormState>({})

/** Plain buttons; `primary` marks the page's main form. inline field errors from Payload, a "Saved" line. Submits without form-reset so a failed save keeps what was typed; `reset` clears it after success (add forms). */
export function SettingsForm({ action, children, submit = 'Save', reset, primary, inline, confirm, bar, copy }: { confirm?: string; bar?: boolean; copy?: boolean; action: (p: FormState, fd: FormData) => Promise<FormState>; children?: ReactNode; submit?: string; reset?: boolean; primary?: boolean; inline?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {})
  const ref = useRef<HTMLFormElement>(null)
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (state.saved) setDirty(false)
    if (reset && state.saved) ref.current?.reset()
  }, [reset, state])
  useEffect(() => {
    const invalid = ref.current?.querySelector<HTMLElement>('[aria-invalid]')
    invalid?.closest('details')?.setAttribute('open', '')
    invalid?.focus()
  }, [state])
  const status = (
    <>
      {state.saved && <span role="status" className="small ok">Saved</span>}
      {state.error && <span role="alert" className="small err">{state.error}</span>}
    </>
  )
  return (
    <Ctx value={state}>
      <form
        ref={ref}
        className={inline ? 'sform inline' : 'sform'}
        onChange={bar ? () => setDirty(true) : undefined}
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          startTransition(() => formAction(fd))
        }}
      >
        {bar && (
          <NextStepBar sentence={dirty ? 'Unsaved changes' : 'Change the settings below, then save'}>
            <div className="flex flex-wrap items-center gap-3 max-sm:justify-end">
              {status}
              <Button disabled={pending}>{submit}</Button>
            </div>
          </NextStepBar>
        )}
        {children}
        {!bar && (
          <div className="actions">
            {confirm ? <ConfirmButton label={submit} confirm={confirm} primary={primary} /> : <Button variant={primary ? 'default' : 'outline'} disabled={pending}>{submit}</Button>}
            {status}
          </div>
        )}
        {state.notice && (copy ? <CopyField text={state.notice} /> : <p role="status" className="mono notice">{state.notice}</p>)}
      </form>
    </Ctx>
  )
}

type Opt = string | [value: string, label: string]

/** `hint` is the help line, `example` renders as "e.g. <mono value>", `explain` is a "What is this?" disclosure. `rows` makes it a textarea. */
export function Field({ name, label, hint, example, explain, options, empty, rows, ...rest }: { name: string; label: string; hint?: string; example?: string; explain?: string; options?: Opt[]; empty?: string; rows?: number } & Omit<ComponentProps<'input'>, 'name'>) {
  const error = useContext(Ctx).fields?.[name]
  const uid = useId()
  const described = [hint && `${uid}-h`, example && `${uid}-x`, error && `${uid}-e`].filter(Boolean).join(' ') || undefined
  const props = { name, id: uid, 'aria-invalid': !!error || undefined, 'aria-describedby': described }
  return (
    <div className="field">
      <label htmlFor={uid} className="small label-strong">{label}</label>
      {hint && <span id={`${uid}-h`} className="small muted">{hint}</span>}
      {options ? (
        <select {...props} defaultValue={rest.defaultValue as string} onChange={rest.onChange as never} disabled={rest.disabled}>
          {empty !== undefined && <option value="">{empty}</option>}
          {options.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o}>{o}</option>))}
        </select>
      ) : rows ? (
        <textarea {...props} rows={rows} defaultValue={rest.defaultValue as string} disabled={rest.disabled} required={rest.required} />
      ) : (
        <input {...props} {...rest} />
      )}
      {example && <span id={`${uid}-x`} className="small muted">e.g. <span className="mono">{example}</span></span>}
      {explain && <details className="small muted"><summary>What is this?</summary>{explain}</details>}
      {error && <span id={`${uid}-e`} role="alert" className="small err">{error}</span>}
    </div>
  )
}

/** A `mono` block with a Copy button; the label flips to "Copied" for a moment. `block` is multi-line code (scrolls inside its own box) instead of a one-line notice. */
export function CopyField({ text, block }: { text: string; block?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="stack">
      {block ? <pre className="mono notice overflow-x-auto">{text}</pre> : <p role="status" className="mono notice">{text}</p>}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => {
          void navigator.clipboard?.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

export type PickOption = { value: string; label?: string; meta?: string }

/**
 * A checkbox list that posts its checked values comma-joined under `name`. Saved `value`s missing from `options` stay in the list, checked, with `missingMeta`.
 * The add row appends a name typed by hand (any non-empty text; `login` also drops a leading @), so a forge that cannot list options never blocks saving.
 */
export function MultiPick({ name, legend, hint, options, value, addLabel, example, missingMeta, emptyNote, notice, login, mono = true, disabled }: { name: string; legend: string; hint?: string; options: PickOption[]; value: string[]; addLabel: string; example?: string; missingMeta: string; emptyNote?: string; notice?: string; login?: boolean; mono?: boolean; disabled?: boolean }) {
  const error = useContext(Ctx).fields?.[name]
  const uid = useId()
  const [items, setItems] = useState<PickOption[]>(() => [...options, ...value.filter((v) => !options.some((o) => o.value === v)).map((v) => ({ value: v, meta: missingMeta }))])
  const [checked, setChecked] = useState(() => new Set(value))
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.replace(/,/g, '').trim().replace(login ? /^@/ : /^$/, '')
    if (!v) return
    if (!items.some((i) => i.value === v)) setItems((all) => [...all, { value: v, meta: 'added by hand' }])
    setChecked((c) => new Set(c).add(v))
    setDraft('')
  }
  return (
    <fieldset className="checks" disabled={disabled} aria-describedby={error ? `${uid}-e` : undefined}>
      <legend className="small label-strong">{legend}</legend>
      {hint && <span className="small muted">{hint}</span>}
      <input type="hidden" name={name} value={items.filter((i) => checked.has(i.value)).map((i) => i.value).join(',')} />
      {items.map((i) => (
        <label key={i.value} className="check">
          <input type="checkbox" checked={checked.has(i.value)} onChange={(e) => setChecked((c) => { const n = new Set(c); if (e.target.checked) n.add(i.value); else n.delete(i.value); return n })} />
          <span className="stack-1">
            <span className={mono ? 'mono break-anywhere' : 'break-anywhere'}>{i.label ?? i.value}</span>
            {i.meta && <span className="small muted">{i.meta}</span>}
          </span>
        </label>
      ))}
      {notice && <span className="small muted">{notice}</span>}
      {!checked.size && emptyNote && <span className="small muted">{emptyNote}</span>}
      <div className="flex gap-2">
        <Input
          aria-label={addLabel}
          placeholder={example}
          value={draft}
          aria-invalid={!!error || undefined}
          className="min-w-0 flex-1"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add}>Add</Button>
      </div>
      {error && <span id={`${uid}-e`} role="alert" className="small err">{error}</span>}
    </fieldset>
  )
}

export function Checks({ name, items, checked }: { name: string; items: { id: number; label: string }[]; checked: number[] }) {
  return (
    <fieldset className="checks">
      <legend className="small muted">Workspaces</legend>
      {items.map((i) => (
        <label key={i.id} className="check"><input type="checkbox" name={name} value={i.id} defaultChecked={checked.includes(i.id)} />{i.label}</label>
      ))}
    </fieldset>
  )
}

/** Two clicks: the first arms, the second submits. No browser dialog. `danger` text unless `primary`. */
export function ConfirmButton({ label, confirm, primary }: { label: string; confirm: string; primary?: boolean }) {
  const [armed, setArmed] = useState(false)
  return (
    <>
      <Button type={armed ? 'submit' : 'button'} variant={primary ? 'default' : 'outline'} className={primary ? undefined : 'text-destructive'} onClick={() => setArmed(true)}>{armed ? confirm : label}</Button>
      {armed && <Button type="button" variant="outline" onClick={() => setArmed(false)}>Cancel</Button>}
    </>
  )
}
