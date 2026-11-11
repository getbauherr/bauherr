'use client'
import { ActionBarPrimitive, AttachmentPrimitive, AuiIf, ComposerPrimitive, ErrorPrimitive, MessagePrimitive, ThreadPrimitive, useAui, useAuiEvent, useAuiState } from '@assistant-ui/react'
import { useEffect, useState, type FC, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ArrowUp, X } from '@/components/icons'
import { cn } from '@/lib/utils'
import { wrongTypeMessage } from '../../../../lib/intake/media-check'
import { mediaIdOf, type Custom } from './adapter'
import { FeedbackButtons } from './feedback'
import { ArrowDown, Check, Copy, Paperclip, Refresh, Stop } from './icons'
import { MarkdownText } from './markdown'
import { ToolPart } from './tools'

const MAX_IMAGES = 6
export type Kind = 'ticket' | 'overview' | 'settings' | 'other' | 'request'
export const kindOf = (path: string): Kind => (path.startsWith('/tickets/') ? 'ticket' : path === '/' || path.startsWith('/?') ? 'overview' : path.startsWith('/settings') ? 'settings' : 'other')
const suggestions: Record<Kind, string[]> = {
  ticket: ['What is blocking this ticket?', 'Summarise the plan', 'What happens next?', 'What needs me here?'],
  overview: ['What needs me right now?', 'What is the factory working on?', 'Which tickets are blocked?'],
  settings: ['Explain this page'],
  other: ['What needs me right now?', 'Explain this page'],
  request: [],
}

/** `arg`: the command takes the rest of the line (`/comment <text>`); `run` gets it and the ids of the images in the composer, and answers false to keep the composer as it is (a failure). */
export type Command = { name: string; help: string; arg?: boolean; run(arg: string, mediaIds: number[]): void | boolean | Promise<void | boolean> }

const isSynthetic = (m: { metadata?: { custom?: unknown } }): boolean => !!(m.metadata?.custom as Custom | undefined)?.synthetic

const imageOf = (a: { content?: readonly { type: string; image?: string }[] | undefined }): string | undefined => a.content?.find((c) => c.type === 'image')?.image

/** A thumbnail of an attached image: uploading, failed or ready; a click enlarges it. */
const Thumb: FC<{ removable?: boolean }> = ({ removable }) => {
  const a = useAuiState((s) => s.attachment)
  const [open, setOpen] = useState(false)
  const src = imageOf(a)
  const error = a.status.type === 'incomplete' ? (a.status.message ?? 'Upload failed') : null
  const uploading = a.status.type === 'running'
  return (
    <AttachmentPrimitive.Root className={cn('relative size-16 shrink-0 overflow-hidden rounded-md border bg-secondary text-[11px]', error && 'border-destructive')} data-testid="attachment" title={error ?? a.name}>
      {src ? (
        <>
          <button type="button" aria-label={`Enlarge ${a.name}`} className="size-full" onClick={() => setOpen(true)}><img src={src} alt={a.name} className="size-full object-cover" /></button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-3xl">
              <DialogTitle className="sr-only">{a.name}</DialogTitle>
              <img src={src} alt={a.name} className="max-h-[80dvh] max-w-full object-contain" />
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <span className={cn('flex size-full items-center justify-center p-1 text-center', error ? 'text-destructive' : 'text-muted-foreground')}>{uploading ? 'Uploading...' : 'Failed'}</span>
      )}
      {removable && (
        <AttachmentPrimitive.Remove asChild>
          <button type="button" aria-label="Remove image" className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 text-muted-foreground hover:text-foreground"><X /></button>
        </AttachmentPrimitive.Remove>
      )}
    </AttachmentPrimitive.Root>
  )
}

const UserMessage: FC = () => (
  <MessagePrimitive.Root className="flex flex-col items-end gap-1" data-role="user">
    <div className="flex flex-wrap justify-end gap-1.5 empty:hidden"><MessagePrimitive.Attachments>{() => <Thumb />}</MessagePrimitive.Attachments></div>
    <div className="max-w-[90%] rounded-md bg-accent px-3 py-2 text-[14px] leading-6 wrap-anywhere whitespace-pre-wrap empty:hidden"><MessagePrimitive.Parts /></div>
  </MessagePrimitive.Root>
)

const elapsed = (since: number) => Math.max(0, Math.floor((Date.now() - since) / 1000))

/** Shown whenever the run is active but nothing visibly streams (before the first event, between tool calls). */
const Waiting: FC = () => {
  const [start] = useState(() => Date.now())
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div role="status" data-testid="waiting" className="mt-1 inline-flex items-center gap-2 text-[13px] text-muted-foreground">
      <span className="flex gap-1" aria-hidden>{[0, 150, 300].map((d) => <span key={d} className="size-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: `${d}ms` }} />)}</span>
      Working... {elapsed(start)} s
    </div>
  )
}

const waiting = (m: { role: string; status?: { type: string }; content: readonly { type: string; text?: string; result?: unknown }[] }): boolean => {
  if (m.role !== 'assistant' || m.status?.type !== 'running') return false
  const last = m.content.at(-1)
  return !last || (last.type === 'text' && last.text === '') || (last.type === 'tool-call' && last.result !== undefined)
}

const nf = new Intl.NumberFormat('en')
/** model · tokens in → out · seconds (cost when the gateway knows a price). */
const Usage: FC = () => {
  const u = (useAuiState((s) => s.message.metadata.custom) as Custom | undefined)?.usage
  if (!u || !(u.tokensIn || u.tokensOut)) return null
  return (
    <p data-testid="usage" className="text-xs text-muted-foreground">
      {u.model} · {nf.format(u.tokensIn)} → {nf.format(u.tokensOut)} tokens · {(u.ms / 1000).toFixed(1)} s{u.costUsd != null && ` · $${u.costUsd.toFixed(4)}`}
    </p>
  )
}

const iconBtn = 'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground'

const Retry: FC = () => {
  const aui = useAui()
  return <Button type="button" size="sm" variant="outline" className="mt-1" onClick={() => aui.message().reload()}>Retry</Button>
}

const QuestionsMessage: FC = () => (
  <MessagePrimitive.Root className="empty:hidden" data-role="questions"><MessagePrimitive.Parts components={{ tools: { Fallback: ToolPart } }} /></MessagePrimitive.Root>
)

const AssistantMessage: FC = () => (
  <MessagePrimitive.Root className="flex flex-col gap-1" data-role="assistant">
    <MessagePrimitive.Parts components={{ Text: MarkdownText, tools: { Fallback: ToolPart } }} />
    <AuiIf condition={(s) => waiting(s.message)}><Waiting /></AuiIf>
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root role="alert" data-testid="chat-error" className="rounded-md border border-destructive px-3 py-2 text-[14px] text-destructive"><ErrorPrimitive.Message /></ErrorPrimitive.Root>
      <Retry />
    </MessagePrimitive.Error>
    <AuiIf condition={(s) => s.message.status?.type !== 'running'}>
      <Usage />
      <div className="flex items-center gap-0.5 group-data-[kind=request]/dock:hidden">
        <ActionBarPrimitive.Root className="contents">
          <ActionBarPrimitive.Copy asChild>
            <button type="button" aria-label="Copy" title="Copy" className={iconBtn}>
              <AuiIf condition={(s) => s.message.isCopied}><Check /></AuiIf>
              <AuiIf condition={(s) => !s.message.isCopied}><Copy /></AuiIf>
            </button>
          </ActionBarPrimitive.Copy>
          <ActionBarPrimitive.Reload asChild><button type="button" aria-label="Regenerate" title="Regenerate" className={iconBtn}><Refresh /></button></ActionBarPrimitive.Reload>
        </ActionBarPrimitive.Root>
        <AuiIf condition={(s) => !!(s.message.metadata.custom as Custom | undefined)?.answerId || !!s.message.metadata.submittedFeedback || !!(s.message.metadata.custom as Custom | undefined)?.usage}><FeedbackButtons /></AuiIf>
      </div>
    </AuiIf>
  </MessagePrimitive.Root>
)

const Welcome: FC<{ kind: Kind }> = ({ kind }) => (
  <div className={cn('flex flex-col gap-3 py-6', useAuiState((s) => s.thread.messages.length) ? 'mt-2' : 'my-auto')} data-testid="welcome">
    <p className="text-[15px] font-semibold">{kind === 'request' ? 'Describe what you need' : 'Ask the factory'}</p>
    <p className="text-[14px] text-muted-foreground">{kind === 'request' ? 'Say it in a sentence, or paste a screenshot. I will ask a few questions, then you check the request before it is sent.' : 'I can see the page you are on. Ask about it, or tell me what to approve.'}</p>
    <div className="flex flex-wrap gap-2">
      {suggestions[kind].map((s) => (
        <ThreadPrimitive.Suggestion key={s} prompt={s} send className="rounded-full border px-3 py-1.5 text-left text-[13px] hover:bg-secondary">{s}</ThreadPrimitive.Suggestion>
      ))}
    </div>
  </div>
)

/** Inline error for a file the composer refused (wrong type, too many); an upload error also turns the thumbnail red. */
const AddError: FC = () => {
  const [message, setMessage] = useState('')
  const aui = useAui()
  const count = useAuiState((s) => s.composer.attachments.length)
  const text = useAuiState((s) => s.composer.text)
  useAuiEvent('composer.attachmentAddError', (e) => setMessage(e.reason === 'not-accepted' ? wrongTypeMessage : e.message))
  useAuiEvent('composer.attachmentAdd', () => setMessage(''))
  useEffect(() => {
    if (count <= MAX_IMAGES) return
    const extra = aui.composer().getState().attachments.at(-1)
    if (extra) void aui.composer().attachment({ id: extra.id }).remove()
    setMessage(`At most ${MAX_IMAGES} images per message`)
  }, [count, aui])
  useEffect(() => setMessage(''), [text])
  return message ? <p role="alert" className="text-[13px] text-destructive">{message}</p> : null
}

const Composer: FC<{ commands: Command[]; kind: Kind }> = ({ commands, kind }) => {
  const aui = useAui()
  const text = useAuiState((s) => s.composer.text)
  const count = useAuiState((s) => s.composer.attachments.length)
  const typed = /^\/(\w*)$/.exec(text)
  const matches = typed ? commands.filter((c) => c.name.startsWith(typed[1]!)) : []
  const run = async (c: Command, arg: string) => {
    const ids = aui.composer().getState().attachments.flatMap((a) => (a.content ?? []).flatMap((p) => (p.type === 'image' ? [mediaIdOf(p.image)] : []))).filter((id): id is number => id !== null)
    if ((await c.run(arg, ids)) !== false) void aui.composer().reset()
  }
  return (
    <ComposerPrimitive.Root
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        const m = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(text.trim())
        const c = m && commands.find((x) => x.name === m[1] && (x.arg || !m[2]))
        if (!c) return
        e.preventDefault()
        void run(c, m[2]?.trim() ?? '')
      }}
    >
      <ComposerPrimitive.AttachmentDropzone className="flex flex-col gap-2 rounded-md border bg-card p-2 focus-within:ring-2 focus-within:ring-ring data-[dragging=true]:ring-2 data-[dragging=true]:ring-ring">
        {!!matches.length && (
          <ul className="flex flex-col rounded-md border bg-popover text-[13px]" role="listbox" aria-label="Commands">
            {matches.map((c) => (
              <li key={c.name}><button type="button" role="option" className="flex w-full gap-2 px-2 py-1.5 text-left hover:bg-secondary" onClick={() => (c.arg ? aui.composer().setText(`/${c.name} `) : void run(c, ''))}><span className="font-mono">/{c.name}</span><span className="text-muted-foreground">{c.help}</span></button></li>
            ))}
          </ul>
        )}
        <AddError />
        <div className="flex flex-wrap gap-1.5 empty:hidden"><ComposerPrimitive.Attachments>{() => <Thumb removable />}</ComposerPrimitive.Attachments></div>
        <ComposerPrimitive.Input rows={1} maxRows={8} style={{ outline: 'none' }} aria-label="Message the factory" placeholder={kind === 'request' ? 'Describe what you need, or paste a screenshot' : 'Ask, or paste a screenshot'} className="max-h-48 min-h-9 w-full resize-none bg-transparent px-1 py-1.5 text-[14px] leading-5 outline-none placeholder:text-muted-foreground" />
        <div className="flex items-center justify-between">
          <ComposerPrimitive.AddAttachment asChild>
            <button type="button" aria-label="Attach image" title="Attach image" disabled={count >= MAX_IMAGES} className={cn(iconBtn, 'disabled:opacity-40')}><Paperclip /></button>
          </ComposerPrimitive.AddAttachment>
          <AuiIf condition={(s) => !s.thread.isRunning}>
            <ComposerPrimitive.Send asChild><Button type="submit" size="icon" aria-label="Send" className="size-8"><ArrowUp /></Button></ComposerPrimitive.Send>
          </AuiIf>
          <AuiIf condition={(s) => s.thread.isRunning}>
            <ComposerPrimitive.Cancel asChild><Button type="button" size="icon" variant="outline" aria-label="Stop" className="size-8"><Stop /></Button></ComposerPrimitive.Cancel>
          </AuiIf>
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  )
}

/** Thread, composer and everything between; `above` renders over the composer (context chip, notes). */
export const DockThread: FC<{ kind: Kind; commands: Command[]; above: ReactNode }> = ({ kind, commands, above }) => (
  <ThreadPrimitive.Root data-kind={kind} className="aui-root group/dock flex min-h-0 flex-1 flex-col text-foreground">
    <ThreadPrimitive.Viewport className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3" aria-live="polite">
      <ThreadPrimitive.Messages>{({ message }) => (message.role === 'user' ? <UserMessage /> : isSynthetic(message) ? <QuestionsMessage /> : <AssistantMessage />)}</ThreadPrimitive.Messages>
      <AuiIf condition={(s) => s.thread.messages.every(isSynthetic)}><Welcome kind={kind} /></AuiIf>
    </ThreadPrimitive.Viewport>
    <div className="relative flex flex-col gap-2 border-t p-3">
      <ThreadPrimitive.ScrollToBottom asChild>
        <button type="button" aria-label="Scroll to bottom" className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-full border bg-card p-1.5 text-muted-foreground shadow-sm hover:text-foreground disabled:hidden"><ArrowDown /></button>
      </ThreadPrimitive.ScrollToBottom>
      {above}
      <Composer commands={commands} kind={kind} />
    </div>
  </ThreadPrimitive.Root>
)
