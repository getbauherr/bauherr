'use client'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { noteUndone } from '../../(shell)/inbox/steer'
import { decideTicket } from '../../(shell)/tickets/actions'
import {
  mergeEntries,
  neighbour,
  nextWaiting,
  type InboxEntry,
  type PagedGroup,
  type Paging,
} from '../../lib/inbox-entries'
import { sendComment } from '../../lib/inbox-send'
import { UNDO_MS } from '../../lib/inbox-words'
import { useInboxKeys } from './use-inbox-keys'
import { usePagedGroups } from './use-paged-groups'
import { usePendingDecisions, type Staged } from './use-pending-decisions'

const run = async ({ input, comment, recordId }: Staged): Promise<string | null> =>
  comment === undefined ? ((await decideTicket(input)).error ?? null) : sendComment(recordId, comment)

const notify = ({ key, receipt, number }: Staged, undo: () => void) =>
  toast(`${receipt} on #${number}`, { id: key, duration: UNDO_MS, action: { label: 'Undo', onClick: undo } })

export function useInboxState(first: InboxEntry[], paging: Record<PagedGroup, Paging>, selected: string) {
  const router = useRouter()
  const [, navigate] = useTransition()
  const [sheet, setSheet] = useState(false)
  const paged = usePagedGroups(paging)
  const entries = useMemo(() => mergeEntries(first, paged.extras), [first, paged.extras])
  const open = useCallback(
    (id: string | null) => navigate(() => router.replace(id === null ? '/inbox' : `/inbox?t=${id}`, { scroll: false })),
    [router],
  )
  const pending = usePendingDecisions({
    run,
    notify,
    delay: UNDO_MS,
    onCommit: ({ key }) => void toast.dismiss(key),
    onError: (_staged, message) => toast.error(message),
    onUndo: (staged) => {
      if (staged.steered) void noteUndone(staged.recordId).then(() => router.refresh())
    },
    onSettled: (staged, advance) => {
      router.refresh()
      const decided = staged.comment === undefined
      if (advance && decided && String(staged.recordId) === selected) open(nextWaiting(entries, selected))
    },
  })
  const select = useCallback(
    (id: string) => {
      pending.flush()
      setSheet(false)
      open(id)
    },
    [pending, open],
  )
  const move = useCallback(
    (step: 1 | -1) => {
      const next = neighbour(entries, selected, step)
      if (next !== null && next !== selected) select(next)
    },
    [entries, selected, select],
  )
  useInboxKeys(move)
  return { entries, more: paged.more, pending, select, sheet, setSheet }
}
