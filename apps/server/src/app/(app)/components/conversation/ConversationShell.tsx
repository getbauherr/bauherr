'use client'
import { useEffect, useRef, useState, useSyncExternalStore, type FC, type ReactNode } from 'react'
import { ArtifactCard } from '../assistant-ui/elements/artifact-card'
import { CanvasSplitBody, CanvasSplitDocument, CanvasSplitHeader } from '../assistant-ui/elements/canvas-split'
import { PanelClose } from '../chat/icons'
import { Button } from '../ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../ui/sheet'
import { useSidebar } from '../ui/sidebar'

const PHONE = '(max-width: 640px)'
const usePhone = (): boolean =>
  useSyncExternalStore(
    (cb) => {
      const m = matchMedia(PHONE)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => matchMedia(PHONE).matches,
    () => false,
  )

/** The app sidebar is an icon rail while a conversation is open; the person can expand it, and it comes back as it was on leaving. */
const useRail = (): void => {
  const { open, setOpen, isMobile } = useSidebar()
  const was = useRef(open)
  useEffect(() => {
    const before = was.current
    if (!isMobile) setOpen(false)
    return () => setOpen(before)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

export type ShellArtifact = {
  title: string
  /** The version chip's text. */
  version: string
  /** One line for the card that stands in for a collapsed panel. */
  summary: string
  /** Buttons of the panel header, left of the collapse button. */
  actions?: ReactNode
  body: ReactNode
  /** The panel's foot: status, the one primary action, what happens next. */
  foot: ReactNode
  writing?: boolean
}

/**
 * The shell of a task conversation (refinement now, request drafting next): the participant header over a stream and a composer on the left, the artifact the conversation is
 * shaping on the right with its foot (the submit bar). The panel collapses to a card in the stream; on a phone it is a bottom sheet opened from a sticky bar (`bar`).
 * It knows nothing of what is talked about: every part is a slot.
 */
export const ConversationShell: FC<{ header: ReactNode; stream: ReactNode; composer: ReactNode; artifact: ShellArtifact; bar: ReactNode }> = ({ header, stream, composer, artifact, bar }) => {
  useRail()
  const phone = usePhone()
  const [open, setOpen] = useState(true)
  const [sheet, setSheet] = useState(false)
  const panel = (
    <CanvasSplitDocument>
      <CanvasSplitHeader title={artifact.title} version={artifact.version}>
        {artifact.actions}
        {!phone && <Button type="button" variant="ghost" size="icon" aria-label="Collapse the panel" title="Collapse the panel" className="size-8" onClick={() => setOpen(false)}><PanelClose /></Button>}
      </CanvasSplitHeader>
      <CanvasSplitBody writing={artifact.writing}>{artifact.body}</CanvasSplitBody>
      <div data-testid="artifact-foot" className="border-t border-border bg-card px-5 py-3">{artifact.foot}</div>
    </CanvasSplitDocument>
  )
  return (
    <div data-testid="conversation-shell" className={`-m-8 grid h-[calc(100dvh-3.5rem)] min-h-[32rem] min-w-0 bg-background max-sm:-m-4 max-sm:h-[calc(100dvh-3.5rem)] ${open && !phone ? 'grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)]' : 'grid-cols-1'}`}>
      <section aria-label="Conversation" className="@container flex min-h-0 min-w-0 flex-col">
        <div className="mx-auto flex min-h-0 w-full max-w-[720px] flex-1 flex-col px-6 max-sm:px-3">
          <div className="shrink-0 pt-3">{header}</div>
          {stream}
          <div className="flex shrink-0 flex-col gap-2 pt-2 pb-4">
            {!open && !phone && <ArtifactCard data-testid="artifact-card" title={artifact.title} meta={artifact.summary} onClick={() => setOpen(true)} />}
            {phone && <button type="button" data-testid="artifact-bar" onClick={() => setSheet(true)} className="sticky bottom-0 flex min-h-11 items-center justify-between gap-2 rounded-md border border-border bg-card px-3 text-left text-[14px]">{bar}</button>}
            {composer}
          </div>
        </div>
      </section>
      {open && !phone && <aside data-testid="artifact-panel" aria-label={artifact.title} className="flex min-h-0 min-w-0 flex-col border-l border-border bg-card">{panel}</aside>}
      {phone && (
        <Sheet open={sheet} onOpenChange={setSheet}>
          <SheetContent side="bottom" data-testid="artifact-sheet" className="h-[85dvh] gap-0 p-0">
            <SheetTitle className="sr-only">{artifact.title}</SheetTitle>
            <SheetDescription className="sr-only">{artifact.summary}</SheetDescription>
            {panel}
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
