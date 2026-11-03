'use client'
import { createContext, startTransition, useActionState, useContext, useId, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import type { FormState } from '../lib/settings'
import { Button } from './ui/button'

const Ctx = createContext<FormState>({})

/** Plain buttons; `primary` marks the page's main form. inline field errors from Payload, a "Saved" line. Submits without form-reset so a failed save keeps what was typed; `reset` clears it after success (add forms). */
export function SettingsForm({ action, children, submit = 'Save', reset, primary, inline, confirm, bar, copy }: { confirm?: string; bar?: boolean; copy?: boolean; action: (p: FormState, fd: FormData) => Promise<FormState>; children?: ReactNode; submit?: string; reset?: boolean; primary?: boolean; inline?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {})
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (reset && state.saved) ref.current?.reset()
  }, [reset, state])
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-invalid]')?.focus()
  }, [state])
  return (
    <Ctx value={state}>
      <form
        ref={ref}
        className={inline ? 'sform inline' : 'sform'}
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          startTransition(() => formAction(fd))
        }}
      >
        {children}
        <div className={bar ? 'actions savebar' : 'actions'}>
          {confirm ? <ConfirmButton label={submit} confirm={confirm} primary={primary} /> : <Button variant={primary ? 'default' : 'outline'} disabled={pending}>{submit}</Button>}
          {state.saved && <span role="status" className="small ok">Saved</span>}
          {state.error && <span role="alert" className="small err">{state.error}</span>}
        </div>
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

/** A `mono` block with a Copy button; the label flips to "Copied" for a moment. */
export function CopyField({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="stack">
      <p role="status" className="mono notice">{text}</p>
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
