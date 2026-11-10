'use client'
import { useAui, useAuiState } from '@assistant-ui/react'
import { useState, type FC } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ThumbsDown, ThumbsUp } from './icons'

export const REASONS = ['Wrong', 'Incomplete', 'Too long', 'Did not do what I asked', 'Other']
const btn = 'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground'

/** Thumbs up sends at once; thumbs down opens reason chips and a note. Both go through the runtime's FeedbackAdapter. */
export const FeedbackButtons: FC = () => {
  const aui = useAui()
  const rated = useAuiState((s) => s.message.metadata.submittedFeedback?.type)
  const [open, setOpen] = useState(false)
  const [reasons, setReasons] = useState<string[]>([])
  const [note, setNote] = useState('')
  const send = () => {
    aui.message().submitFeedback({ type: 'negative', comment: JSON.stringify({ reasons, note: note.trim() }) })
    setOpen(false)
    setReasons([])
    setNote('')
  }
  return (
    <>
      <button type="button" aria-label="Good answer" title="Good answer" aria-pressed={rated === 'positive'} className={cn(btn, rated === 'positive' && 'text-ok')} onClick={() => rated !== 'positive' && aui.message().submitFeedback({ type: 'positive' })}><ThumbsUp /></button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Bad answer" title="Bad answer" aria-pressed={rated === 'negative'} className={cn(btn, rated === 'negative' && 'text-destructive')}><ThumbsDown /></button>
        </PopoverTrigger>
        <PopoverContent data-testid="feedback-popover" className="flex flex-col gap-2">
          <p className="font-semibold">What was wrong?</p>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button key={r} type="button" aria-pressed={reasons.includes(r)} onClick={() => setReasons((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]))} className="rounded-full border px-2.5 py-1 text-xs aria-pressed:border-primary aria-pressed:bg-accent">{r}</button>
            ))}
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} aria-label="Note" placeholder="Anything to add? (optional)" className="resize-none rounded-md border bg-background px-3 py-2 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <Button type="button" size="sm" className="self-end" onClick={send}>Send</Button>
        </PopoverContent>
      </Popover>
    </>
  )
}
