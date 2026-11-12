'use client'
import { MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react'
import { createContext, useContext, useState, type FC, type ReactNode } from 'react'
import { History } from 'lucide-react'
import { CheckIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { MessageActions, type Reaction } from '../assistant-ui/elements/message-actions'
import { FeedbackDialog } from '../assistant-ui/elements/feedback-dialog'
import { SpeakerTurn } from '../assistant-ui/elements/speaker-identity'
import { RoleAvatar } from '../team/RoleAvatar'
import { api } from '../chat/api'
import { shortModel } from '../../lib/format'
import { cn } from '@/lib/utils'
import type { Image, Point, Speaker } from '../../../../lib/refine/model'

const REASONS = ['Wrong', 'Incomplete', 'Too long', 'Did not do what I asked', 'Other']
export const when = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

type Custom = { speaker?: Speaker; feedback?: 'up' | 'down' | null; images?: Image[]; settled?: string[] }
/** `thread`: the chat thread that stores the ratings (null: the conversation has none, so no thumbs). */
type Ctx = { thread: number | null; /** Whether each message names its executor (false: the partner is the executor, as the Factory assistant is in request drafting). */ executor?: boolean; locked: boolean; points: Point[]; busy: boolean; tail: ReactNode; onChange(id: string): void }
const StreamCtx = createContext<Ctx>(null as never)

/** Who speaks, the way the participant header says it: the session that asked (with presence), or the Factory assistant that replied. Never the session for a server-side reply. */
const Executor: FC<{ s: Speaker }> = ({ s }) =>
  s.session ? (
    <span data-testid="speaker-executor" className="inline-flex items-center gap-1.5">
      <span role="img" aria-label={s.live ? 'connected' : 'not connected'} className={cn('size-2 rounded-full', s.live ? 'bg-ok' : 'bg-muted-foreground/50')} />
      {s.session}{s.run != null && <> · asked in <a className="text-primary" href={`/runs/${s.run}`}>Run #{s.run}</a></>}
    </span>
  ) : (
    <span data-testid="speaker-executor">Factory assistant</span>
  )

/** Thumbs (down opens the feedback dialog element; both go to the existing chat feedback store) and copy. */
const Actions: FC = () => {
  const { thread } = useContext(StreamCtx)
  const id = useAuiState((m) => m.message.id)
  const text = useAuiState((m) => m.message.content.map((p) => (p.type === 'text' ? p.text : '')).join(''))
  const stored = useAuiState((m) => (m.message.metadata.custom as Custom).feedback ?? null)
  const [rated, setRated] = useState<Reaction>(stored)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const [reasons, setReasons] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  const send = async (value: 'up' | 'down') => {
    await api.feedback(String(thread!), { messageId: id, value, ...(value === 'down' && { reasons, note: note.trim() }) }).catch(() => {})
    setRated(value)
  }
  return (
    <>
      <MessageActions
        copied={copied}
        reaction={rated}
        onCopy={() => void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})}
        onReactionChange={(r) => (r === 'down' ? setOpen(true) : r && void send(r))}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm border-0 bg-transparent p-0 shadow-none">
          <DialogHeader className="sr-only"><DialogTitle>Feedback</DialogTitle><DialogDescription>Tell us what was wrong with this answer.</DialogDescription></DialogHeader>
          <FeedbackDialog reasons={REASONS} selected={reasons} note={note} sent={sent} onToggleReason={(r) => setReasons((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))} onNoteChange={setNote} onSubmit={() => void send('down').then(() => setSent(true))} />
        </DialogContent>
      </Dialog>
    </>
  )
}

/** A settled point as a compact chip: what was asked, the answer, and "Change" (reopens only that point). */
const Chip: FC<{ p: Point }> = ({ p }) => {
  const { locked, busy, onChange } = useContext(StreamCtx)
  return (
    <span data-testid="point-chip" data-point={p.id} className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 self-start rounded-md border border-border bg-card px-2.5 py-1.5 text-[14px]">
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-ok text-white"><CheckIcon className="size-3" strokeWidth={3} /></span>
      <span className="min-w-0 wrap-anywhere"><span className="text-muted-foreground">{p.title}: </span>{p.status === 'dropped' ? 'No longer needed' : p.answer}</span>
      {!locked && <button type="button" disabled={busy} onClick={() => onChange(p.id)} className="cursor-pointer text-primary hover:underline disabled:opacity-50">Change</button>}
    </span>
  )
}

const UserMessage: FC = () => {
  const images = useAuiState((m) => (m.message.metadata.custom as Custom).images) ?? []
  return (
    <MessagePrimitive.Root className="flex flex-col items-end gap-1" data-role="user">
      <div className="max-w-[85%] rounded-lg bg-accent px-3.5 py-2 text-[14px] leading-6 wrap-anywhere whitespace-pre-wrap">
        {images.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{images.map((i) => <img key={i.id} src={i.url} alt="Attached screenshot" data-testid="message-image" className="h-24 w-auto max-w-[200px] rounded-md border border-border object-cover" />)}</div>}
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  )
}

const AssistantMessage: FC = () => {
  const { locked, points, tail, thread, executor = true } = useContext(StreamCtx)
  const custom = useAuiState((m) => m.message.metadata.custom as Custom)
  const writing = useAuiState((m) => m.message.status?.type === 'running')
  const last = useAuiState((m) => m.message.isLast)
  const s = custom.speaker
  if (!s) return null
  const settled = (custom.settled ?? []).flatMap((id) => points.filter((p) => p.id === id && p.status !== 'open'))
  return (
    <MessagePrimitive.Root data-role="assistant" data-writing={writing || undefined} className="group/message">
      <SpeakerTurn data-testid="speaker" data-kind={s.kind} avatar={<RoleAvatar avatar={s.avatar ?? 'orchestrator'} size="sm" animate={writing} />} name={s.role ?? 'Orchestrator'} detail={executor ? <Executor s={s} /> : undefined} meta={<><span data-testid="speaker-model" title={s.model ?? undefined}>{s.model ? shortModel(s.model) : 'no model call'}</span> · <time>{when(s.at)}</time></>}>
        <div data-testid="reply-text" className="text-[14px] leading-6 wrap-anywhere whitespace-pre-wrap empty:hidden"><MessagePrimitive.Parts /></div>
        {settled.map((p) => <Chip key={p.id} p={p} />)}
        {last && !writing && tail}
        {writing ? <p role="status" data-testid="writing" className="m-0 animate-pulse text-[13px] text-muted-foreground">is writing...</p> : !locked && thread !== null && <div className="opacity-60 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100"><Actions /></div>}
      </SpeakerTurn>
    </MessagePrimitive.Root>
  )
}

/** The stream of a conversation: assistant-ui's thread of messages, with the open question as a card at the end of the last agent message. */
export const Stream: FC<Ctx & { earlier: { role: string; text: string }[]; working: boolean; /** The test id of the scrolling thread. */ name?: string; children?: ReactNode }> = ({ earlier, working, name = 'refine-thread', children, ...ctx }) => {
  const [showEarlier, setShowEarlier] = useState(false)
  return (
    <StreamCtx.Provider value={ctx}>
      <ThreadPrimitive.Root className="aui-root flex min-h-0 flex-1 flex-col text-foreground">
        <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto py-4" aria-live="polite" data-testid={name} autoScroll>
          {earlier.length > 0 && (
            <button type="button" data-testid="earlier" onClick={() => setShowEarlier(true)} className="mx-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[13px] text-muted-foreground hover:text-foreground">
              <History className="size-3.5" />Earlier conversation · {earlier.length} message{earlier.length === 1 ? '' : 's'}
            </button>
          )}
          <ThreadPrimitive.Messages>{({ message }) => (message.role === 'user' ? <UserMessage /> : <AssistantMessage />)}</ThreadPrimitive.Messages>
          {working && <p role="status" data-testid="waiting" className="m-0 animate-pulse text-[13px] text-muted-foreground">Working...</p>}
          {children}
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
      <Dialog open={showEarlier} onOpenChange={setShowEarlier}>
        <DialogContent className="max-h-[80dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Earlier conversation</DialogTitle><DialogDescription>The old chat about this Ticket, read-only.</DialogDescription></DialogHeader>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[14px]">{earlier.map((m, i) => <li key={i} className="wrap-anywhere whitespace-pre-wrap"><span className="font-medium">{m.role === 'user' ? 'You' : 'Assistant'}: </span>{m.text.slice(0, 600)}</li>)}</ul>
        </DialogContent>
      </Dialog>
    </StreamCtx.Provider>
  )
}
