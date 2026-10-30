'use client'
import { createContext, startTransition, useActionState, useContext, useId, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import type { FormState } from '../lib/settings'

const Ctx = createContext<FormState>({})

/** Plain buttons; `primary` marks the page's main form. inline field errors from Payload, a "Saved" line. Submits without form-reset so a failed save keeps what was typed; `reset` clears it after success (add forms). */
export function SettingsForm({ action, children, submit = 'Save', reset, primary, inline, confirm }: { confirm?: string; action: (p: FormState, fd: FormData) => Promise<FormState>; children?: ReactNode; submit?: string; reset?: boolean; primary?: boolean; inline?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {})
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (reset && state.saved) ref.current?.reset()
  }, [reset, state])
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
        <div className="actions">
          {confirm ? <ConfirmButton label={submit} confirm={confirm} /> : <button className={primary ? 'btn primary' : 'btn'} disabled={pending}>{submit}</button>}
          {state.saved && <span role="status" className="small ok">Saved</span>}
          {state.error && <span role="alert" className="small err">{state.error}</span>}
        </div>
        {state.notice && <p role="status" className="mono notice">{state.notice}</p>}
      </form>
    </Ctx>
  )
}

type Opt = string | [value: string, label: string]

export function Field({ name, label, hint, options, empty, ...rest }: { name: string; label: string; hint?: string; options?: Opt[]; empty?: string } & Omit<ComponentProps<'input'>, 'name'>) {
  const error = useContext(Ctx).fields?.[name]
  const uid = useId()
  const props = { name, id: uid, 'aria-invalid': !!error || undefined, 'aria-describedby': error ? `${uid}-e` : undefined }
  return (
    <div className="field">
      <label htmlFor={props.id} className="small muted">{label}</label>
      {options ? (
        <select {...props} defaultValue={rest.defaultValue as string} onChange={rest.onChange as never} disabled={rest.disabled}>
          {empty !== undefined && <option value="">{empty}</option>}
          {options.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o}>{o}</option>))}
        </select>
      ) : (
        <input {...props} {...rest} />
      )}
      {hint && <span className="small muted">{hint}</span>}
      {error && <span id={props['aria-describedby']} role="alert" className="small err">{error}</span>}
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

/** Two clicks: the first arms, the second submits. No browser dialog. */
export function ConfirmButton({ label, confirm }: { label: string; confirm: string }) {
  const [armed, setArmed] = useState(false)
  return (
    <>
      <button type={armed ? 'submit' : 'button'} className="btn danger" onClick={() => setArmed(true)}>{armed ? confirm : label}</button>
      {armed && <button type="button" className="btn" onClick={() => setArmed(false)}>Cancel</button>}
    </>
  )
}
