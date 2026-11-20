'use client'
import { useRef, useState, useTransition, type ReactNode } from 'react'
import { decideTicket } from '../../(shell)/tickets/actions'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'

export type DecisionAction = {
  choice: string
  label: string
  variant: 'default' | 'outline' | 'danger'
  prompt?: string
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
const NOTE_ID = 'decision-note'

const answersOf = (form: HTMLFormElement): Record<string, string> => {
  const answers: Record<string, string> = {}
  new FormData(form).forEach((value, key) => {
    if (key.startsWith(ANSWER_PREFIX) && typeof value === 'string') answers[key.slice(ANSWER_PREFIX.length)] = value
  })
  return answers
}

const resolve = (action: DecisionAction, picked: HTMLInputElement | null): DecisionAction => ({
  ...action,
  choice: picked?.value ?? action.choice,
  label: picked?.dataset.label ?? action.label,
  ...(picked?.dataset.prompt ? { prompt: picked.dataset.prompt } : {}),
})

function NoteDialog(props: {
  action: DecisionAction | null
  pending: boolean
  error: string | null
  onSend: (note: string) => void
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  const { action } = props
  return (
    <Dialog open={action !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action?.label}</DialogTitle>
          <DialogDescription>{action?.prompt}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Label htmlFor={NOTE_ID}>Note</Label>
          <Textarea
            id={NOTE_ID}
            className="font-sans"
            value={note}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
          />
          {props.error && <p role="alert" className="small text-destructive">{props.error}</p>}
          <DialogFooter>
            <Button type="button" disabled={props.pending || note.trim() === ''} onClick={() => props.onSend(note)}>
              {action?.label}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

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

export function DecisionForm({ recordId, ask, seq, sentence, actions, pick, children }: Props) {
  const form = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<DecisionAction | null>(null)
  const [pending, start] = useTransition()

  const send = (action: DecisionAction, note?: string) =>
    start(async () => {
      const answers = form.current ? answersOf(form.current) : {}
      const extra = { ...(note ? { note } : {}), ...(Object.keys(answers).length > 0 ? { answers } : {}) }
      const result = await decideTicket({ recordId, ask, seq, choice: action.choice, ...extra })
      setError(result.error ?? null)
      if (!result.error) setNoteFor(null)
    })

  const press = (action: DecisionAction) => {
    const picked = pick ? (form.current?.querySelector<HTMLInputElement>('input[name="choice"]:checked') ?? null) : null
    if (pick && !picked) return setError('Choose an answer first.')
    const chosen = resolve(action, picked)
    setError(null)
    if (chosen.prompt) return setNoteFor(chosen)
    send(chosen)
  }

  return (
    <form ref={form} onSubmit={(event) => event.preventDefault()} className="contents">
      {children}
      <ActionBar
        sentence={sentence}
        actions={actions}
        error={noteFor ? null : error}
        pending={pending}
        onPress={press}
      />
      <NoteDialog
        key={noteFor?.choice ?? 'closed'}
        action={noteFor}
        pending={pending}
        error={error}
        onSend={(note) => noteFor && send(noteFor, note)}
        onClose={() => setNoteFor(null)}
      />
    </form>
  )
}
