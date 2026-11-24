'use client'
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import type { FormState } from '../lib/settings'
import { LeaveGuard } from './LeaveGuard'
import { NextStepBar } from './NextStepBar'
import { FormStateContext } from './SettingsFormState'
import { Alert } from './ui/alert'
import { Button } from './ui/button'

export { Field } from './SettingsField'
export { MultiPick, type PickOption } from './SettingsMultiPick'
export { Checks, PickField } from './SettingsPickers'
export { useFieldError } from './SettingsFormState'

const submitWith = (formAction: (fd: FormData) => void) => (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault()
  const fd = new FormData(e.currentTarget)
  startTransition(() => formAction(fd))
}

function useFormLifecycle(state: FormState, reset: boolean | undefined, track: boolean) {
  const ref = useRef<HTMLFormElement>(null)
  const [dirty, setDirty] = useState(false)
  const [round, setRound] = useState(0)
  useEffect(() => {
    setRound((n) => n + 1)
    if (state.saved) {
      setDirty(false)
      ref.current?.querySelectorAll<HTMLInputElement>('input[type=password]').forEach((i) => {
        i.value = ''
      })
    }
    if (reset && state.saved) ref.current?.reset()
  }, [reset, state])
  useEffect(() => {
    const form = ref.current
    if (!track || !form) return
    const mark = () => setDirty(true)
    form.addEventListener('input', mark)
    form.addEventListener('change', mark)
    return () => {
      form.removeEventListener('input', mark)
      form.removeEventListener('change', mark)
    }
  }, [track])
  useEffect(() => {
    const invalid = ref.current?.querySelector<HTMLElement>('[aria-invalid]')
    invalid?.closest('details')?.setAttribute('open', '')
    invalid?.focus()
  }, [state])
  return { ref, dirty, round }
}

function FormStatus({ state, unsaved }: { state: FormState; unsaved?: boolean }) {
  return (
    <>
      {unsaved && <span className="small text-muted-foreground">Not saved yet</span>}
      {state.saved && !unsaved && (
        <span role="status" className="small text-ok">
          Saved
        </span>
      )}
      {state.error && (
        <span role="alert" className="small text-destructive">
          {state.error}
        </span>
      )}
    </>
  )
}

function FormNotice({ state, noticeHint, copy }: { state: FormState; noticeHint?: string; copy?: boolean }) {
  return (
    <>
      {state.notice && noticeHint && <span className="small text-muted-foreground">{noticeHint}</span>}
      {state.notice &&
        (copy ? (
          <CopyField text={state.notice} block={state.notice.includes('\n')} />
        ) : (
          <Alert role="status" className="mono">
            {state.notice}
          </Alert>
        ))}
    </>
  )
}

function SubmitRow({
  state,
  round,
  pending,
  submit,
  confirm,
  primary,
  unsaved,
}: {
  state: FormState
  unsaved: boolean
  round: number
  pending: boolean
  submit: string
  confirm?: string
  primary?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {confirm ? (
        <ConfirmButton key={round} label={submit} confirm={confirm} primary={primary} />
      ) : (
        <Button variant={primary ? 'default' : 'outline'} disabled={pending}>
          {submit}
        </Button>
      )}
      <FormStatus state={state} unsaved={unsaved} />
    </div>
  )
}

type SettingsFormProps = {
  after?: (state: FormState) => ReactNode
  noticeHint?: string
  confirm?: string
  bar?: boolean
  copy?: boolean
  action: (p: FormState, fd: FormData) => Promise<FormState>
  children?: ReactNode
  submit?: string
  reset?: boolean
  primary?: boolean
  inline?: boolean
}

export function SettingsForm({
  action,
  children,
  submit = 'Save',
  reset,
  primary,
  inline,
  confirm,
  bar,
  copy,
  noticeHint,
  after,
}: SettingsFormProps) {
  const [state, formAction, pending] = useActionState(action, {})
  const formId = useId()
  const track = bar || /^Save/.test(submit)
  const { ref, dirty, round } = useFormLifecycle(state, reset, !!track)
  return (
    <FormStateContext value={state}>
      <form
        ref={ref}
        id={formId}
        className={inline ? 'flex flex-row items-center gap-4' : 'flex flex-col gap-4'}
        onSubmit={submitWith(formAction)}
      >
        {bar && (
          <NextStepBar
            sentence={dirty ? 'Unsaved changes' : 'Change the settings below, then save'}
            primary={{ label: submit, disabled: pending, form: formId }}
          >
            <FormStatus state={state} unsaved={dirty} />
          </NextStepBar>
        )}
        {children}
        {!bar && (
          <SubmitRow
            state={state}
            round={round}
            pending={pending}
            submit={submit}
            confirm={confirm}
            primary={primary}
            unsaved={dirty}
          />
        )}
        <FormNotice state={state} noticeHint={noticeHint} copy={copy} />
      </form>
      {track && dirty && <LeaveGuard />}
      {after?.(state)}
    </FormStateContext>
  )
}

export function CopyField({ text, block }: { text: string; block?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-4">
      {block ? (
        <Alert role="status" className="mono overflow-x-auto">
          <pre className="m-0">{text}</pre>
        </Alert>
      ) : (
        <Alert role="status" className="mono">
          {text}
        </Alert>
      )}
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

export function ConfirmButton({ label, confirm, primary }: { label: string; confirm: string; primary?: boolean }) {
  const [armed, setArmed] = useState(false)
  return (
    <>
      <Button
        type={armed ? 'submit' : 'button'}
        variant={primary ? 'default' : 'outline'}
        className={primary ? undefined : 'text-destructive'}
        onClick={() => setArmed(true)}
      >
        {armed ? confirm : label}
      </Button>
      {armed && (
        <Button type="button" variant="outline" onClick={() => setArmed(false)}>
          Cancel
        </Button>
      )}
    </>
  )
}
