'use client'
import type { ExternalStoreThreadListAdapter } from '@assistant-ui/react'
import { MenuIcon } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { selectable, type InboxEntry, type PagedGroup, type Paging } from '../../lib/inbox-entries'
import type { ThreadModel } from '../../lib/inbox-thread'
import { StatusChip } from '../StatusChip'
import { Button } from '../ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '../ui/sheet'
import { PendingProvider } from './DecisionToolUI'
import { InboxHeader } from './InboxHeader'
import { InboxList } from './InboxList'
import { InboxThread } from './InboxThread'
import { StatusLine } from './StatusLine'
import { useScrollToNewest } from './use-inbox-keys'
import { useInboxState } from './use-inbox-state'
import { intentsOf, useOutbox, withOutbox } from './use-outbox'
import { useStickyTop } from './use-sticky-top'

const FRAME = [
  'grid items-start gap-2 pb-16',
  'min-[900px]:grid-cols-[17rem_minmax(0,1fr)] min-[900px]:gap-4',
  'min-[1280px]:grid-cols-[20rem_minmax(0,1fr)]',
].join(' ')

const COLUMN = [
  'mx-auto flex min-h-[calc(100dvh-12rem)] w-full max-w-[44rem] flex-col gap-2',
  '[&_.aui-thread-followup-suggestions>div]:mx-0',
  '[&_.aui-thread-root]:h-auto [&_.aui-thread-root]:flex-1',
  '[&_[data-slot$=thread-viewport]]:overflow-visible',
  '[&_.aui-thread-viewport-footer]:bottom-8',
  '[&_.aui-thread-viewport-footer]:shadow-[0_-14px_14px_-6px_var(--color-background)]',
].join(' ')

type Props = { entries: InboxEntry[]; paging: Record<PagedGroup, Paging>; thread: ThreadModel }

const placeholderOf = (thread: ThreadModel): string =>
  thread.number === null
    ? 'Open a ticket to write to the factory'
    : `Tell the factory what to do with #${thread.number}`

type NarrowProps = { thread: ThreadModel; sheet: boolean; onSheet: (open: boolean) => void; children: ReactNode }

function NarrowBar({ thread, sheet, onSheet, children }: NarrowProps) {
  return (
    <div className="bg-background sticky top-0 z-20 flex items-center gap-2 py-1 min-[900px]:hidden">
      <Sheet open={sheet} onOpenChange={onSheet}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm"><MenuIcon /> {thread.title}</Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-3">
          <SheetTitle className="sr-only">Inbox</SheetTitle>
          {children}
        </SheetContent>
      </Sheet>
      {thread.view && <StatusChip status={thread.view.status} closedAs={thread.view.closedAs} />}
    </div>
  )
}

export function InboxView({ entries: first, paging, thread }: Props) {
  const state = useInboxState(first, paging, thread.id)
  const { entries, more, pending, select, sheet, setSheet } = state
  const outbox = useOutbox(thread)
  const stick = useStickyTop<HTMLDivElement>()
  useScrollToNewest(thread.id, thread.messages.length)
  const intents = intentsOf({ pending, recordId: thread.recordId, proposal: outbox.proposal })
  const messages = useMemo(
    () => withOutbox(thread.messages, outbox.sent, intents),
    [thread.messages, outbox.sent, intents.length, outbox.proposal],
  )
  const threads = entries.filter(selectable).map((e) => ({ status: 'regular' as const, id: e.id, title: e.title }))
  const threadList: ExternalStoreThreadListAdapter = { threadId: thread.id, threads, onSwitchToThread: select }
  const list = <InboxList entries={entries} selected={thread.id} more={more} />
  return (
    <PendingProvider pending={pending} onProposalDone={outbox.clearProposal}>
      <InboxThread
        messages={messages}
        suggestions={thread.suggestions}
        sending={outbox.busy}
        placeholder={placeholderOf(thread)}
        threadList={threadList}
        onSend={outbox.send}
        frame={(body) => (
          <div className={FRAME}>
            <div ref={stick} className="sticky hidden self-start border-r pr-2 min-[900px]:block">{list}</div>
            <NarrowBar thread={thread} sheet={sheet} onSheet={setSheet}>{list}</NarrowBar>
            <div className={COLUMN}>
              <InboxHeader thread={thread} />
              {body}
              <StatusLine entries={entries} className="bg-background sticky bottom-0 z-10 px-4 py-1" />
            </div>
          </div>
        )}
      />
    </PendingProvider>
  )
}
