'use client'
import { useRef, useState, useTransition, type ReactNode } from 'react'
import { NOTE_MAX } from '../../../../core/limits'
import { decideTicket } from '../../(shell)/tickets/actions'
import { Button } from '../ui/button'
import { CommentField, CommentToggle } from './CommentField'
import { useComment } from './useComment'

export type DecisionAction = {
  choice: string
  label: string
  variant: 'default' | 'outline' | 'danger'
  prompt?: string
  say?: string
  fixed?: boolean
}

type Props = {
  recordId: number
  ask: string
  seq: number
  sentence?: string | undefined
  actions: DecisionAction[]
  pick?: boolean
  children: ReactNode
}

const ANSWER_PREFIX = 'answer:'

const answersOf = (form: HTMLFormElement): Record<string, string> => {
  const answers: Record<string, string> = {}
  new FormData(form).forEach((value, key) => {
    if (key.startsWith(ANSWER_PREFIX) && typeof value === 'string') answers[key.slice(ANSWER_PREFIX.length)] = value
  })
  return answers
}

type Prompted = { prompt?: string; say?: string }

const promptOf = (input: HTMLInputElement): Prompted => ({
  ...(input.dataset.prompt ? { prompt: input.dataset.prompt } : {}),
  ...(input.dataset.say ? { say: input.dataset.say } : {}),
})

const resolve = (action: DecisionAction, picked: HTMLInputElement | null): DecisionAction => ({
  ...action,
  choice: picked?.value ?? action.choice,
  label: picked?.dataset.label ?? action.label,
  ...(picked ? promptOf(picked) : {}),
})

function ActionBar(props: {
  sentence: string | undefined
  actions: DecisionAction[]
  error: string | null
  pending: boolean
  onPress: (action: DecisionAction) => void
}) {
  return (
    <div
      data-testid="action-bar"
      className="flex flex-wrap items-center gap-2 rounded-b-md border-t border-border bg-card px-4 py-3"
    >
      {props.sentence ? (
        <p className="min-w-full flex-[1_1_20ch] sm:mr-auto sm:min-w-0">{props.sentence}</p>
      ) : (
        <span className="sm:mr-auto" />
      )}
      {props.error && <span role="alert" className="small text-destructive">{props.error}</span>}
      {props.actions.map((action) => (
        <Button
          key={action.choice}
          type="button"
          variant={action.variant === 'danger' ? 'outline' : action.variant}
          className={action.variant === 'danger' ? 'text-destructive' : undefined}
          disabled={props.pending}
          onClick={() => props.onPress(action)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  )
}

function Form({ recordId, ask, seq, sentence, actions, pick, children }: Props) {
  const form = useRef<HTMLFormElement>(null)
  const comment = useComment()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const send = (action: DecisionAction) =>
    start(async () => {
      const answers = form.current && action.choice === 'approve' ? answersOf(form.current) : {}
      const note = comment.empty ? {} : { note: comment.note }
      const extra = { ...note, ...(Object.keys(answers).length > 0 ? { answers } : {}) }
      const result = await decideTicket({ recordId, ask, seq, choice: action.choice, ...extra })
      setError(result.error ?? null)
      if (!result.error) comment.reset()
    })

  const press = (action: DecisionAction) => {
    const picking = pick && !action.fixed
    const checked = form.current?.querySelector<HTMLInputElement>('input[name="choice"]:checked') ?? null
    const picked = picking ? checked : null
    if (picking && !picked) return setError('Choose an answer first.')
    const chosen = resolve(action, picked)
    setError(null)
    if (!chosen.prompt || !comment.empty) return send(chosen)
    comment.demand(`${chosen.say ?? 'Write a comment'}, then press ${action.label} again.`, chosen.prompt)
  }

  const picked = (target: EventTarget) => {
    if (!(target instanceof HTMLInputElement) || target.name !== 'choice') return
    setError(null)
    comment.settle(target.dataset.prompt ?? null)
    if (target.dataset.prompt) comment.reveal(target.dataset.prompt)
  }

  return (
    <form
      ref={form}
      onSubmit={(event) => event.preventDefault()}
      onChange={(event) => picked(event.target)}
      className="contents"
    >
      {children}
      {comment.open ? (
        <CommentField
          value={comment.note}
          max={NOTE_MAX}
          hint={comment.hint}
          missing={comment.empty ? comment.missing : null}
          areaRef={comment.area}
          onChange={comment.setNote}
        />
      ) : (
        <CommentToggle onOpen={() => comment.reveal(null)} />
      )}
      <ActionBar sentence={sentence} actions={actions} error={error} pending={pending} onPress={press} />
    </form>
  )
}

export function DecisionForm(props: Props) {
  return <Form key={`${props.ask}:${props.seq}`} {...props} />
}
