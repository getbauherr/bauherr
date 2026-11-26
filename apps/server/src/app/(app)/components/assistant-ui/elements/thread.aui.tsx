'use client'

import { ThreadFollowupSuggestions } from '@/components/assistant-ui/elements/follow-up-suggestions.aui'
import { TooltipIconButton } from '@/components/assistant-ui/elements/tooltip-icon-button'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { AuiIf, SuggestionPrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react'
import { ArrowDownIcon } from 'lucide-react'
import { useContext, useLayoutEffect, useRef, type FC } from 'react'
import {
  EMPTY_COMPONENTS,
  ThreadComponents,
  ThreadComponentsContext,
  isHistoryLoadingView,
  isNewChatView,
} from './thread-context'
import { SpokenMessage } from './thread-spoken'
import { Composer } from './thread-composer'
import { AssistantMessage } from './thread-assistant'
import { EditComposer, UserMessage } from './thread-user'

export type ThreadProps = {
  components?: ThreadComponents | undefined
  autoFocus?: boolean | undefined
}
const ThreadHistorySkeleton: FC = () => (
  <div
    data-slot="aui_thread-history-skeleton"
    role="status"
    className={cn(
      'animate-in fade-in fill-mode-both flex flex-col gap-y-6 [animation-delay:150ms]',
      '[animation-duration:200ms]',
    )}
  >
    <span className="sr-only">Loading conversation</span>
    <Skeleton className="ml-auto h-9 w-2/5 rounded-xl motion-reduce:animate-none" />
    <div className="flex flex-col gap-y-2">
      <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-3/5 motion-reduce:animate-none" />
    </div>
    <Skeleton className="ml-auto h-9 w-1/3 rounded-xl motion-reduce:animate-none" />
    <div className="flex flex-col gap-y-2">
      <Skeleton className="h-4 w-10/12 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
    </div>
  </div>
)
export const Thread: FC<ThreadProps> = ({ components = EMPTY_COMPONENTS, autoFocus = true }) => {
  const isEmpty = useAuiState(isNewChatView)
  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadRoot isEmpty={isEmpty} autoFocus={autoFocus} />
    </ThreadComponentsContext.Provider>
  )
}
const ThreadRoot: FC<{
  isEmpty: boolean
  autoFocus: boolean
}> = ({ isEmpty, autoFocus }) => {
  const {
    Welcome = ThreadWelcome,
    composer,
    welcome,
    afterMessages,
    aboveComposer,
  } = useContext(ThreadComponentsContext)
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ['--thread-max-width' as string]: '44rem',
        ['--composer-bg' as string]: 'color-mix(in oklab, var(--color-muted) 30%, transparent)',
        ['--composer-radius' as string]: '1rem',
        ['--composer-padding' as string]: '8px',
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
      >
        <div
          className={cn(
            'mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4',
            isEmpty && 'justify-center',
          )}
        >
          <AuiIf condition={isNewChatView}>{welcome ?? <Welcome />}</AuiIf>
          <AuiIf condition={isHistoryLoadingView}>
            <ThreadHistorySkeleton />
          </AuiIf>

          <ThreadLoadEarlier />

          <div data-slot="aui_message-group" className="mb-14 flex flex-col gap-y-6 empty:hidden">
            <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
          </div>
          {afterMessages}

          <ThreadPrimitive.ViewportFooter
            className={cn(
              'aui-thread-viewport-footer bg-background flex flex-col gap-4 overflow-visible pb-4 md:pb-6',
              !isEmpty && 'sticky bottom-0 mt-auto rounded-t-(--composer-radius)',
            )}
          >
            <ThreadScrollToBottom />
            <ThreadFollowupSuggestions />
            {aboveComposer}
            {composer !== false && <Composer autoFocus={autoFocus} />}
            <AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
              <ThreadSuggestions />
            </AuiIf>
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  )
}
const ThreadMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage } = useContext(ThreadComponentsContext)
  const role = useAuiState((s) => s.message.role)
  const isEditing = useAuiState((s) => s.message.composer.isEditing)
  const isSpoken = useAuiState((s) => s.message.metadata.modality === 'voice')
  if (isEditing) return <EditComposer />
  if (isSpoken) return <SpokenMessage />
  if (role === 'user') return <UserMessage />
  return <AssistantMessageComponent />
}
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  "[tabindex]:not([tabindex='-1']):not([disabled])",
].join(', ')
const nextFocusable = (start: Element) => {
  for (let element = start.nextElementSibling; element; element = element.nextElementSibling) {
    const target = element.matches(FOCUSABLE_SELECTOR) ? element : element.querySelector(FOCUSABLE_SELECTOR)
    if (target instanceof HTMLElement) return target
  }
  return null
}
const ThreadLoadEarlier: FC = () => {
  const visible = useAuiState((s) => s.thread.hasEarlier || s.thread.isLoadingEarlier)
  const loading = useAuiState((s) => s.thread.isLoadingEarlier)
  const slotRef = useRef<HTMLDivElement>(null)
  const focusedRef = useRef<Element | null>(null)
  useLayoutEffect(() => {
    const focused = focusedRef.current
    const slot = slotRef.current
    if (visible || !focused || focused.isConnected || !slot) return
    focusedRef.current = null
    const active = document.activeElement
    if (active && active !== document.body) return
    nextFocusable(slot)?.focus()
  }, [visible])
  return (
    <div
      ref={slotRef}
      className="contents"
      onFocus={(event) => {
        focusedRef.current = event.target
      }}
    >
      <span role="status" className="sr-only">
        {loading ? 'Loading earlier messages' : ''}
      </span>
      {visible && (
        <ThreadPrimitive.LoadEarlier asChild>
          <Button
            variant="ghost"
            size="sm"
            data-slot="aui_thread-load-earlier"
            className="aui-thread-load-earlier text-muted-foreground mb-6 self-center rounded-full"
          >
            <span className={cn(loading && 'shimmer motion-reduce:animate-none')}>
              {loading ? 'Loading earlier messages' : 'Load earlier messages'}
            </span>
          </Button>
        </ThreadPrimitive.LoadEarlier>
      )}
    </div>
  )
}
const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className={cn(
          'aui-thread-scroll-to-bottom dark:border-border dark:bg-background',
          'dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4',
          'disabled:invisible',
        )}
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  )
}
const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col px-2">
      <p
        className={cn(
          'aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in',
          'fill-mode-both text-2xl font-medium tracking-tight duration-200',
        )}
      >
        How can I help you today?
      </p>
    </div>
  )
}
const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions flex w-full flex-col">
      <ThreadPrimitive.Suggestions>{() => <ThreadSuggestionItem />}</ThreadPrimitive.Suggestions>
    </div>
  )
}
const ThreadSuggestionItem: FC = () => {
  return (
    <div
      className={cn(
        'aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in',
        'fill-mode-both duration-200',
      )}
    >
      <SuggestionPrimitive.Trigger send asChild>
        <button
          type="button"
          className={cn(
            'aui-thread-welcome-suggestion group hover:bg-foreground/[0.03]',
            'focus-visible:ring-ring/50 flex w-full items-baseline gap-2.5 rounded-md px-2',
            'py-2 text-start text-sm transition-colors outline-none focus-visible:ring-1',
            'motion-reduce:transition-none',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'text-muted-foreground/60 group-hover:text-foreground font-mono text-xs',
              'transition-colors motion-reduce:transition-none',
            )}
          >
            {'>'}
          </span>
          <span className="min-w-0 flex-1 truncate">
            <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1 text-foreground" />{' '}
            <SuggestionPrimitive.Description
              className={cn('aui-thread-welcome-suggestion-text-2 text-muted-foreground empty:hidden')}
            />
          </span>
        </button>
      </SuggestionPrimitive.Trigger>
    </div>
  )
}
