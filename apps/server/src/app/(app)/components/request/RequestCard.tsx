'use client'

import { TaskCard, type TaskCardState } from '../assistant-ui/elements/task-card'
import { Button } from '../ui/button'
import type { DraftView } from '../../../../core/requests/view'
import type { RequestAction } from './request-api'

const TYPES = [
  ['bug', 'Broken'],
  ['change', 'New or different'],
  ['question', 'A question'],
  ['chore', 'Routine'],
] as const

const stateOf = (draft: DraftView | null): TaskCardState => {
  if (draft === null) return 'waiting'
  if (draft.state === 'sent' || draft.state === 'joined') return 'done'
  if (draft.state === 'closed') return 'cancelled'
  return draft.complete ? 'done' : 'waiting'
}

const kb = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1024))} KB`

function Files({ files }: { files: DraftView['files'] }) {
  if (files.length === 0) return <span className="text-muted-foreground">None yet</span>
  return (
    <ul className="m-0 grid list-none gap-1 p-0">
      {files.map((file) => (
        <li key={file.id}>
          {file.name} <span className="text-muted-foreground">({kb(file.bytes)})</span>
        </li>
      ))}
    </ul>
  )
}

function Actions({ draft, busy, act }: { draft: DraftView; busy: boolean; act: (action: RequestAction) => void }) {
  if (draft.state !== 'open') return null
  const question = draft.type === 'question'
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1" aria-label="Type of request">
        {TYPES.map(([type, label]) => (
          <Button
            key={type}
            type="button"
            size="sm"
            variant={draft.type === type ? 'default' : 'outline'}
            disabled={busy}
            onClick={() => act({ action: 'type', type })}
          >
            {label}
          </Button>
        ))}
      </div>
      {question ? (
        <Button type="button" variant="outline" disabled={busy} onClick={() => act({ action: 'close' })}>
          Close the question
        </Button>
      ) : (
        <Button
          type="button"
          variant={draft.questions.length > 0 ? 'outline' : 'default'}
          disabled={busy || !draft.complete}
          onClick={() => act({ action: 'send' })}
        >
          Send request
        </Button>
      )}
      <p className="small m-0 text-muted-foreground">
        {question
          ? 'A question is answered here and builds nothing. Turn it into a bug or a change to send it.'
          : 'Sending writes the summary and the files to the team’s issue tracker. The conversation stays here.'}
      </p>
    </div>
  )
}

function Result({ draft }: { draft: DraftView }) {
  if (draft.state === 'sent') return <>Sent as issue #{draft.issueNumber}.</>
  if (draft.state === 'joined') return <>You joined #{draft.joined?.number}: {draft.joined?.title}.</>
  if (draft.state === 'closed') return <>Closed without a ticket.</>
  if (draft.answer) return <>Answered in the conversation.</>
  if (draft.missing.length > 0) return <>Still missing: {draft.missing.join(', ')}</>
  return draft.type === null ? <>Describe the request to start.</> : <>Complete: you can send it.</>
}

function Details({ draft }: { draft: DraftView | null }) {
  return (
    <dl className="m-0 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Type</dt>
      <dd className="m-0">{draft?.typeWord || '—'}</dd>
      <dt className="text-muted-foreground">Title</dt>
      <dd className="m-0">{draft?.title || '—'}</dd>
      {draft?.fields.map((field) => <FieldRow key={field.key} label={field.label} value={field.value} />)}
      <dt className="text-muted-foreground">Files</dt>
      <dd className="m-0">
        <Files files={draft?.files ?? []} />
      </dd>
    </dl>
  )
}

export function RequestCard({
  draft,
  busy,
  act,
}: {
  draft: DraftView | null
  busy: boolean
  act: (action: RequestAction) => void
}) {
  return (
    <TaskCard
      aria-label="Your request"
      label="Your request"
      state={stateOf(draft)}
      open
      onOpenChange={() => undefined}
      className="max-w-none"
      actions={draft && <Actions draft={draft} busy={busy} act={act} />}
      result={draft ? <Result draft={draft} /> : <>Describe the request to start.</>}
    >
      <Details draft={draft} />
    </TaskCard>
  )
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0">{value || <span className="text-muted-foreground">Missing</span>}</dd>
    </>
  )
}
