'use client'
import { AuiIf, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useAui, useAuiState } from '@assistant-ui/react'
import Link from 'next/link'
import { useEffect, useState, type FC } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ArrowUp } from '@/components/icons'
import { cn } from '@/lib/utils'
import { FeedbackDialog } from '../assistant-ui/elements/feedback-dialog'
import { ThumbsDown, ThumbsUp } from '../chat/icons'
import { api } from '../chat/api'
import type { Speaker } from '../../../../lib/refine/model'

const REASONS = ['Wrong', 'Incomplete', 'Too long', 'Did not do what I asked', 'Other']
const when = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Who speaks: role, executor (session with presence, or the Factory assistant), model, time; a question Triage asked links its Run. */
const SpeakerLine: FC = () => {
  const s = useAuiState((m) => (m.message.metadata.custom as { speaker?: Speaker } | undefined)?.speaker)
  if (!s) return null
  return (
    <p data-testid="speaker" data-kind={s.kind} className="small m-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
      <span className="font-medium text-foreground">{s.role ?? 'You'}</span>
      {s.session && <span data-testid="speaker-executor">session {s.session}<span role="img" aria-label={s.live ? 'connected' : 'not connected'} title={s.live ? 'connected' : 'not connected'} className={cn('ml-1 inline-block size-2 rounded-full align-middle', s.live ? 'bg-ok' : 'bg-muted-foreground/50')} /></span>}
      {s.kind === 'assistant' && <span data-testid="speaker-executor">Factory assistant</span>}
      <span data-testid="speaker-model">{s.model ?? 'no model call'}</span>
      <time>{when(s.at)}</time>
      {s.run != null && <Link className="text-primary" href={`/runs/${s.run}`}>asked in Run #{s.run}</Link>}
    </p>
  )
}

/** Thumbs on an agent message: up at once, down opens the feedback dialog element; both go to the existing chat feedback store. */
const Rate: FC<{ thread: number }> = ({ thread }) => {
  const id = useAuiState((m) => m.message.id)
  const stored = useAuiState((m) => (m.message.metadata.custom as { feedback?: 'up' | 'down' | null } | undefined)?.feedback ?? null)
  const [rated, setRated] = useState<'up' | 'down' | null>(stored)
  const [open, setOpen] = useState(false)
  const [reasons, setReasons] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)
  const btn = 'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground'
  const send = async (value: 'up' | 'down') => {
    await api.feedback(String(thread), { messageId: id, value, ...(value === 'down' && { reasons, note: note.trim() }) }).catch(() => {})
    setRated(value)
  }
  return (
    <div className="flex items-center gap-0.5" data-testid="rate">
      <button type="button" aria-label="Good answer" title="Good answer" aria-pressed={rated === 'up'} className={cn(btn, rated === 'up' && 'text-ok')} onClick={() => void send('up')}><ThumbsUp /></button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><button type="button" aria-label="Bad answer" title="Bad answer" aria-pressed={rated === 'down'} className={cn(btn, rated === 'down' && 'text-destructive')}><ThumbsDown /></button></PopoverTrigger>
        <PopoverContent className="w-80 border-0 bg-transparent p-0 shadow-none">
          <FeedbackDialog
            reasons={REASONS}
            selected={reasons}
            note={note}
            sent={sent}
            onToggleReason={(r) => setReasons((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))}
            onNoteChange={setNote}
            onSubmit={() => void send('down').then(() => setSent(true))}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

const UserMessage: FC = () => (
  <MessagePrimitive.Root className="flex flex-col items-end gap-1" data-role="user">
    <div className="max-w-[90%] rounded-md bg-accent px-3 py-2 text-[14px] leading-6 wrap-anywhere whitespace-pre-wrap"><MessagePrimitive.Parts /></div>
  </MessagePrimitive.Root>
)

const AssistantMessage: FC<{ thread: number; locked: boolean }> = ({ thread, locked }) => (
  <MessagePrimitive.Root className="flex flex-col gap-1" data-role="assistant">
    <SpeakerLine />
    <div className="text-[14px] leading-6 wrap-anywhere whitespace-pre-wrap"><MessagePrimitive.Parts /></div>
    {!locked && <Rate thread={thread} />}
  </MessagePrimitive.Root>
)

/** The thread of the panel (assistant-ui primitives); `restore` puts text a failed turn did not take back into the composer. */
export const Conversation: FC<{ thread: number; locked: boolean; restore: string; onRestored(): void; children?: React.ReactNode }> = ({ thread, locked, restore, onRestored, children }) => {
  const aui = useAui()
  useEffect(() => {
    if (!restore) return
    aui.composer().setText(restore)
    onRestored()
  }, [restore, aui, onRestored])
  return (
    <ThreadPrimitive.Root className="aui-root flex min-w-0 flex-col gap-3 text-foreground">
      <ThreadPrimitive.Viewport className="relative flex max-h-[26rem] min-h-40 flex-col gap-4 overflow-y-auto rounded-md border bg-card p-3" aria-live="polite" data-testid="refine-thread">
        <ThreadPrimitive.Messages>{({ message }) => (message.role === 'user' ? <UserMessage /> : <AssistantMessage thread={thread} locked={locked} />)}</ThreadPrimitive.Messages>
        <AuiIf condition={(s) => s.thread.isRunning}><p role="status" data-testid="waiting" className="small m-0 animate-pulse text-muted-foreground">Working...</p></AuiIf>
      </ThreadPrimitive.Viewport>
      {children}
      {!locked && (
        <ComposerPrimitive.Root className="flex items-end gap-2 rounded-md border bg-card p-2 focus-within:ring-2 focus-within:ring-ring">
          <ComposerPrimitive.Input rows={1} maxRows={6} style={{ outline: 'none' }} aria-label="Your answer" placeholder="Answer in your own words" className="max-h-40 min-h-9 w-full resize-none bg-transparent px-1 py-1 text-[14px]" />
          <ComposerPrimitive.Send asChild><Button type="submit" size="icon" aria-label="Send" className="size-8 shrink-0"><ArrowUp /></Button></ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      )}
    </ThreadPrimitive.Root>
  )
}
