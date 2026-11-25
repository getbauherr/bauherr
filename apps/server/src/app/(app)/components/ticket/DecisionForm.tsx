'use client'
import { useCallback, useRef, useState, useTransition, type ReactNode } from 'react'
import { NOTE_MAX } from '../../../../core/limits'
import { decideTicket } from '../../(shell)/tickets/actions'
import { Button } from '../ui/button'
import { DROP_PREFIX } from './RelationRow'
import { conversationApi } from '../conversation/conversation-api'
import { CommentRuntime } from './CommentRuntime'
import { CommentToggle, DecisionComment } from './DecisionComment'
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
const api = conversationApi()

const answersOf = (form: HTMLFormElement): Record<string, string> => {
  const answers: Record<string, string> = {}
  new FormData(form).forEach((value, key) => {
    if (key.startsWith(ANSWER_PREFIX) && typeof value === 'string') answers[key.slice(ANSWER_PREFIX.length)] = value
  })
  return answers
}

const droppedOf = (form: HTMLFormElement): number[] => {
  const dropped: number[] = []
  new FormData(form).forEach((_value, key) => {
    if (key.startsWith(DROP_PREFIX)) dropped.push(Number(key.slice(DROP_PREFIX.length)))
  })
  return dropped
}

const approvalOf = (form: HTMLFormElement) => {
  const answers = answersOf(form)
  const dropRelations = droppedOf(form)
  return {
    ...(Object.keys(answers).length > 0 ? { answers } : {}),
    ...(dropRelations.length > 0 ? { dropRelations } : {}),
  }
}

const attachFiles = async (ensure: () => Promise<number>, note: string, fileIds: number[]): Promise<string | null> => {
  if (fileIds.length === 0) return null
  try {
    await api.send(await ensure(), note, fileIds)
    return null
  } catch (failure) {
    return failure instanceof Error ? failure.message : 'The attached files were not saved.'
  }
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

type Attach = { ensure: () => Promise<number>; forget: () => void }

function Form({ recordId, ask, seq, sentence, actions, pick, children, ensure, forget }: Props & Attach) {
  const form = useRef<HTMLFormElement>(null)
  const comment = useComment()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const send = (action: DecisionAction) =>
    start(async () => {
      const extra = {
        ...(comment.empty ? {} : { note: comment.note }),
        ...(form.current && action.choice === 'approve' ? approvalOf(form.current) : {}),
      }
      const result = await decideTicket({ recordId, ask, seq, choice: action.choice, ...extra })
      const attached = comment.fileIds
      if (result.error) return setError(result.error)
      const failure = await attachFiles(ensure, comment.note, attached)
      setError(failure)
      forget()
      comment.reset()
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
        <DecisionComment
          left={NOTE_MAX - comment.note.length}
          max={NOTE_MAX}
          hint={comment.hint}
          missing={comment.empty ? comment.missing : null}
          areaRef={comment.area}
        />
      ) : (
        <CommentToggle onOpen={() => comment.reveal(null)} />
      )}
      <ActionBar sentence={sentence} actions={actions} error={error} pending={pending} onPress={press} />
    </form>
  )
}

function Keyed(props: Props) {
  const conversation = useRef<Promise<number> | null>(null)
  const title = `Ticket ${props.recordId} comment`
  const { recordId } = props
  const ensure = useCallback(() => (conversation.current ??= api.create(undefined, title, recordId)), [title, recordId])
  const forget = useCallback(() => {
    conversation.current = null
  }, [])
  return (
    <CommentRuntime conversation={ensure}>
      <Form {...props} ensure={ensure} forget={forget} />
    </CommentRuntime>
  )
}

export function DecisionForm(props: Props) {
  return <Keyed key={`${props.ask}:${props.seq}`} {...props} />
}
