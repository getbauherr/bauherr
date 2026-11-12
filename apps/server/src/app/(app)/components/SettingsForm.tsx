'use client'
import { createContext, startTransition, useActionState, useContext, useId, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import type { FormState } from '../lib/settings'
import { NextStepBar } from './NextStepBar'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Textarea } from './ui/textarea'
import { Alert } from './ui/alert'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { NativeSelect } from './ui/native-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

const Ctx = createContext<FormState>({})

/** Plain buttons; `primary` marks the page's main form. inline field errors from Payload, a "Saved" line. Submits without form-reset so a failed save keeps what was typed; `reset` clears it after success (add forms). */
export function SettingsForm({ action, children, submit = 'Save', reset, primary, inline, confirm, bar, copy }: { confirm?: string; bar?: boolean; copy?: boolean; action: (p: FormState, fd: FormData) => Promise<FormState>; children?: ReactNode; submit?: string; reset?: boolean; primary?: boolean; inline?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {})
  const ref = useRef<HTMLFormElement>(null)
  const formId = useId()
  const [dirty, setDirty] = useState(false)
  const [round, setRound] = useState(0)
  useEffect(() => {
    setRound((n) => n + 1)
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
      {state.saved && <span role="status" className="small text-ok">Saved</span>}
      {state.error && <span role="alert" className="small text-destructive">{state.error}</span>}
    </>
  )
  return (
    <Ctx value={state}>
      <form
        ref={ref}
        id={formId}
        className={inline ? 'flex flex-row items-center gap-4' : 'flex flex-col gap-4'}
        onChange={bar ? () => setDirty(true) : undefined}
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          startTransition(() => formAction(fd))
        }}
      >
        {bar && (
          <NextStepBar sentence={dirty ? 'Unsaved changes' : 'Change the settings below, then save'} primary={{ label: submit, disabled: pending, form: formId }}>
            {status}
          </NextStepBar>
        )}
        {children}
        {!bar && (
          <div className="flex flex-wrap items-center gap-3">
            {confirm ? <ConfirmButton key={round} label={submit} confirm={confirm} primary={primary} /> : <Button variant={primary ? 'default' : 'outline'} disabled={pending}>{submit}</Button>}
            {status}
          </div>
        )}
        {state.notice && (copy ? <CopyField text={state.notice} /> : <Alert role="status" className="mono">{state.notice}</Alert>)}
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
    <div className="flex flex-col gap-1">
      <Label htmlFor={uid} className="small">{label}</Label>
      {hint && <span id={`${uid}-h`} className="small text-muted-foreground">{hint}</span>}
      {options ? (
        <NativeSelect {...props} defaultValue={rest.defaultValue as string} onChange={rest.onChange as never} disabled={rest.disabled}>
          {empty !== undefined && <option value="">{empty}</option>}
          {options.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o}>{o}</option>))}
        </NativeSelect>
      ) : rows ? (
        <Textarea {...props} rows={rows} defaultValue={rest.defaultValue as string} disabled={rest.disabled} required={rest.required} className="min-h-18" />
      ) : (
        <Input {...props} {...rest} />
      )}
      {example && <span id={`${uid}-x`} className="small text-muted-foreground">e.g. <span className="mono">{example}</span></span>}
      {explain && <details className="small text-muted-foreground"><summary className="cursor-pointer">What is this?</summary>{explain}</details>}
      {error && <span id={`${uid}-e`} role="alert" className="small text-destructive">{error}</span>}
    </div>
  )
}

const OTHER = '__other'
const NONE = '__none' // Radix items cannot have an empty value

function Picker({ name, label, options, defaultValue, empty, hint, example, required }: { name: string; label: string; options: Opt[]; defaultValue: string; empty?: string; hint?: string; example?: string; required?: boolean }) {
  const error = useContext(Ctx).fields?.[name]
  const uid = useId()
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
  const described = [hint && `${uid}-h`, error && `${uid}-e`].filter(Boolean).join(' ') || undefined
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={uid} className="small">{label}</Label>
      {hint && <span id={`${uid}-h`} className="small text-muted-foreground">{hint}</span>}
      <input ref={hidden} type="hidden" name={name} value={choice === OTHER ? typed : choice} />
      <Select value={choice === '' ? NONE : choice} onValueChange={(v) => setChoice(v === NONE ? '' : v)}>
        <SelectTrigger id={uid} aria-invalid={!!error || undefined} aria-describedby={described}><SelectValue /></SelectTrigger>
        <SelectContent>
          {empty !== undefined && <SelectItem value={NONE}>{empty}</SelectItem>}
          {options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <SelectItem key={v} value={v}>{l}</SelectItem> })}
          <SelectItem value={OTHER}>Other...</SelectItem>
        </SelectContent>
      </Select>
      {choice === OTHER && <Input aria-label={`${label}, other`} placeholder={example} value={typed} required={required} aria-invalid={!!error || undefined} onChange={(e) => setTyped(e.target.value)} />}
      {error && <span id={`${uid}-e`} role="alert" className="small text-destructive">{error}</span>}
    </div>
  )
}

/**
 * A select of the known `options` plus "Other..." for a typed value, posted under `name`. Without options (a source that could not list them) it is the plain text field, so saving is never blocked.
 * `empty` adds a leading blank option with that label.
 */
export function PickField({ options, empty, defaultValue = '', ...rest }: { name: string; label: string; options: Opt[] | null; defaultValue?: string; empty?: string; hint?: string; example?: string; placeholder?: string; required?: boolean }) {
  return options?.length ? <Picker {...rest} options={options} empty={empty} defaultValue={defaultValue} /> : <Field {...rest} defaultValue={defaultValue} />
}

/** A `mono` block with a Copy button; the label flips to "Copied" for a moment. `block` is multi-line code (scrolls inside its own box) instead of a one-line notice. */
export function CopyField({ text, block }: { text: string; block?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-4">
      {block ? <Alert className="mono overflow-x-auto"><pre className="m-0">{text}</pre></Alert> : <Alert role="status" className="mono">{text}</Alert>}
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
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={disabled} aria-describedby={error ? `${uid}-e` : undefined}>
      <legend className="small p-0 font-medium text-foreground">{legend}</legend>
      {hint && <span className="small text-muted-foreground">{hint}</span>}
      <input type="hidden" name={name} value={items.filter((i) => checked.has(i.value)).map((i) => i.value).join(',')} />
      {items.map((i) => (
        <label key={i.value} className="flex items-center gap-2">
          <Checkbox checked={checked.has(i.value)} onChange={(e) => setChecked((c) => { const n = new Set(c); if (e.target.checked) n.add(i.value); else n.delete(i.value); return n })} />
          <span className="flex min-w-0 flex-col gap-1">
            <span className={mono ? 'mono wrap-anywhere' : 'wrap-anywhere'}>{i.label ?? i.value}</span>
            {i.meta && <span className="small text-muted-foreground">{i.meta}</span>}
          </span>
        </label>
      ))}
      {notice && <span className="small text-muted-foreground">{notice}</span>}
      {!checked.size && emptyNote && <span className="small text-muted-foreground">{emptyNote}</span>}
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
      {error && <span id={`${uid}-e`} role="alert" className="small text-destructive">{error}</span>}
    </fieldset>
  )
}

export function Checks({ name, items, checked }: { name: string; items: { id: number; label: string }[]; checked: number[] }) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="small p-0 text-muted-foreground">Workspaces</legend>
      {items.map((i) => (
        <label key={i.id} className="flex items-center gap-2"><Checkbox name={name} value={i.id} defaultChecked={checked.includes(i.id)} />{i.label}</label>
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

export type ProofRuleRow = { name: string; globs: string; kind: string; command: string; before: boolean }
const PROOF_KINDS: [string, string][] = [['image', 'Screenshot'], ['recording', 'Screen recording'], ['preview', 'Link to try it'], ['transcript', 'Terminal session'], ['sample', 'Request and response, or output'], ['report', 'Test or contract report']]

/** The "Proof for review" rules of a Product: when a changed path matches, the command makes the proof a person judges. Posted as the JSON field `proofRules`. */
export function ProofRules({ rows }: { rows: ProofRuleRow[] }) {
  const error = useContext(Ctx).fields?.proofRules
  const uid = useId()
  const [list, setList] = useState<ProofRuleRow[]>(rows)
  const set = (i: number, patch: Partial<ProofRuleRow>) => setList((l) => l.map((r, n) => (n === i ? { ...r, ...patch } : r)))
  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0" aria-describedby={error ? `${uid}-e` : undefined}>
      <legend className="sr-only">Proof for review</legend>
      <input type="hidden" name="proofRules" value={JSON.stringify(list.map((r) => ({ name: r.name, globs: r.globs, kind: r.kind, command: r.command, before: r.before })))} />
      {list.map((r, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-md border border-border p-4" data-testid="proof-rule">
          <div className="grid gap-3 @lg:grid-cols-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1"><Label htmlFor={`${uid}-n${i}`} className="small">Name</Label><Input id={`${uid}-n${i}`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Screens" /></div>
            <div className="flex flex-col gap-1"><Label htmlFor={`${uid}-k${i}`} className="small">What it shows</Label><NativeSelect id={`${uid}-k${i}`} value={r.kind} onChange={(e) => set(i, { kind: e.target.value, before: e.target.value === 'image' && r.before })}>{PROOF_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect></div>
          </div>
          <div className="flex flex-col gap-1"><Label htmlFor={`${uid}-g${i}`} className="small">Needed when these paths change</Label><Input id={`${uid}-g${i}`} value={r.globs} onChange={(e) => set(i, { globs: e.target.value })} placeholder="src/ui/**, src/pages/**" className="mono" /></div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${uid}-c${i}`} className="small">Command that makes it</Label>
            <span className="small text-muted-foreground">Writes into .bauherr/artifacts/ and lists each file in .bauherr/artifacts.json</span>
            <Input id={`${uid}-c${i}`} value={r.command} onChange={(e) => set(i, { command: e.target.value })} placeholder="pnpm screenshots" className="mono" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {r.kind === 'image' && <label className="small flex items-center gap-2"><Checkbox checked={r.before} onChange={(e) => set(i, { before: e.target.checked })} />Also take it before the change</label>}
            <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setList((l) => l.filter((_, n) => n !== i))}>Remove</Button>
          </div>
        </div>
      ))}
      <div><Button type="button" variant="outline" onClick={() => setList((l) => [...l, { name: '', globs: '', kind: 'image', command: '', before: false }])}>Add proof rule</Button></div>
      {error && <span id={`${uid}-e`} role="alert" className="small text-destructive">{error}</span>}
    </fieldset>
  )
}
