'use client'
import { AttachmentPrimitive, ComposerPrimitive, ErrorPrimitive, MessagePrimitive, ThreadPrimitive, useAui, useAuiEvent, useAuiState } from '@assistant-ui/react'
import { useEffect, useRef, useState, type FC } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowUp, Plus, X } from '@/components/icons'
import { cn } from '@/lib/utils'
import { wrongTypeMessage } from '../../../../lib/intake/media-check'

export type Option = { label: string; recommended?: boolean }
export type Labels = { label: string; placeholder: string }

const bubble = 'max-w-[85%] rounded-md border px-3 py-2 text-[15px] leading-[22px] wrap-anywhere whitespace-pre-wrap'

const Chip: FC<{ removable?: boolean }> = ({ removable }) => {
  const error = useAuiState((s) => (s.attachment.status.type === 'incomplete' ? (s.attachment.status.message ?? 'Upload failed') : null))
  return (
    <AttachmentPrimitive.Root className={cn('inline-flex max-w-full items-center gap-1 rounded-md border bg-secondary px-2 py-1 text-[13px] leading-[18px]', error && 'border-destructive text-destructive')} title={error ?? undefined}>
      <span className="truncate"><AttachmentPrimitive.Name /></span>
      {removable && (
        <AttachmentPrimitive.Remove asChild>
          <button type="button" aria-label="Remove attachment" className="text-muted-foreground hover:text-foreground"><X /></button>
        </AttachmentPrimitive.Remove>
      )}
    </AttachmentPrimitive.Root>
  )
}

/** Inline error for a pasted, dropped or picked file the composer refused before any upload (wrong type); an upload error also turns the chip red. */
const AddError: FC = () => {
  const [message, setMessage] = useState('')
  const text = useAuiState((s) => s.composer.text)
  useAuiEvent('composer.attachmentAddError', (e) => setMessage(e.reason === 'not-accepted' ? wrongTypeMessage : e.message))
  useAuiEvent('composer.attachmentAdd', () => setMessage(''))
  useEffect(() => setMessage(''), [text])
  return message ? <p role="alert" className="text-[13px] leading-[18px] text-destructive">{message}</p> : null
}

const Message: FC = () => {
  const user = useAuiState((s) => s.message.role === 'user')
  return (
    <MessagePrimitive.Root className={cn('flex flex-col gap-1', user ? 'items-end' : 'items-start')} data-role={user ? 'user' : 'assistant'}>
      <div className="flex flex-wrap justify-end gap-1 empty:hidden"><MessagePrimitive.Attachments>{() => <Chip />}</MessagePrimitive.Attachments></div>
      <div className={cn(bubble, user ? 'bg-accent' : 'bg-card', 'empty:hidden')}><MessagePrimitive.Parts /></div>
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className={cn(bubble, 'border-destructive text-destructive')}><ErrorPrimitive.Message /></ErrorPrimitive.Root>
      </MessagePrimitive.Error>
    </MessagePrimitive.Root>
  )
}

/** The model's option buttons: the last assistant message's `metadata.custom.turn.options`. */
const Options: FC = () => {
  const aui = useAui()
  const busy = useAuiState((s) => s.thread.isRunning)
  const turn = useAuiState((s) => {
    const last = s.thread.messages.at(-1)
    return last?.role === 'assistant' ? (last.metadata.custom.turn as { options?: Option[] } | undefined) : undefined
  })
  return (
    <div className="flex flex-wrap gap-2 empty:hidden">
      {turn?.options?.map((o) => (
        <Button key={o.label} type="button" variant={o.recommended ? 'default' : 'outline'} disabled={busy} onClick={() => aui.thread().append(o.label)}>{o.label}{o.recommended ? ' (recommended)' : ''}</Button>
      ))}
    </div>
  )
}

/** Thread, option buttons and (optionally) composer on assistant-ui's primitives, shadcn-styled. Needs an `AssistantRuntimeProvider` above it. */
/** Keeps the unsent composer text in localStorage under `key`, across reloads. */
const Draft: FC<{ storageKey: string }> = ({ storageKey }) => {
  const aui = useAui()
  const text = useAuiState((s) => s.composer.text)
  useEffect(() => {
    let saved: string | null = null
    try {
      saved = localStorage.getItem(storageKey)
    } catch {}
    if (!saved) return
    // The thread runtime is an empty placeholder until it has mounted: retry until setText sticks.
    const timer = setInterval(() => {
      try {
        aui.composer().setText(saved)
        clearInterval(timer)
      } catch {}
    }, 25)
    return () => clearInterval(timer)
  }, [])
  const typed = useRef(false)
  useEffect(() => {
    if (text) typed.current = true
    else if (!typed.current) return
    try {
      text ? localStorage.setItem(storageKey, text) : localStorage.removeItem(storageKey)
    } catch {}
  }, [text])
  return null
}

export const ChatThread: FC<{ first: Labels; next: Labels; composer?: boolean; attachments?: boolean; maxHeight?: string; maxLength?: number; draftKey?: string }> = ({ first, next, composer = true, attachments = false, maxHeight = 'max-h-96', maxLength = 2000, draftKey }) => {
  const started = useAuiState((s) => s.thread.messages.length > 0)
  const busy = useAuiState((s) => s.thread.isRunning)
  const { label, placeholder } = started ? next : first
  return (
    <ThreadPrimitive.Root className="aui-root flex min-h-0 flex-col gap-3 text-foreground">
      <ThreadPrimitive.Viewport className={cn('flex flex-col gap-2 overflow-y-auto', maxHeight)} aria-live="polite">
        <ThreadPrimitive.Messages>{() => <Message />}</ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>
      <Options />
      {composer && (
        <ComposerPrimitive.Root className="flex flex-col gap-2">
          <ComposerPrimitive.AttachmentDropzone className="flex flex-col gap-2 rounded-md data-[dragging=true]:ring-2 data-[dragging=true]:ring-ring">
            <AddError />
          {draftKey && <Draft storageKey={draftKey} />}
            <div className="flex flex-wrap gap-1 empty:hidden"><ComposerPrimitive.Attachments>{() => <Chip removable />}</ComposerPrimitive.Attachments></div>
            <div className="flex items-center gap-2">
              {attachments && (
                <ComposerPrimitive.AddAttachment asChild>
                  <Button type="button" variant="outline" size="icon" aria-label="Add screenshot" title="Add screenshot"><Plus /></Button>
                </ComposerPrimitive.AddAttachment>
              )}
              <ComposerPrimitive.Input rows={1} maxLength={maxLength} disabled={busy} aria-label={label} placeholder={placeholder} className="min-h-9 min-w-0 flex-1 resize-none rounded-md border bg-card px-3 py-1.5 text-[15px] leading-[22px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
              <ComposerPrimitive.Send asChild><Button type="submit"><ArrowUp />Send</Button></ComposerPrimitive.Send>
          </div>
          </ComposerPrimitive.AttachmentDropzone>
        </ComposerPrimitive.Root>
      )}
    </ThreadPrimitive.Root>
  )
}
