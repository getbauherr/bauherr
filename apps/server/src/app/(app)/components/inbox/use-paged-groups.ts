'use client'
import { moreInbox } from '../../(shell)/inbox/actions'
import {
  INBOX_PAGE,
  LIST_OF_PAGED,
  type InboxEntry,
  type ListGroup,
  type Paging,
  type PagedGroup,
} from '../../lib/inbox-entries'
import { useChunks } from '../useChunks'

export type More = { left: number; loading: boolean; load: () => void; auto: boolean }

const fetcher = (group: PagedGroup) => async (after: Paging['cursor'] & object, limit: number) => {
  const chunk = await moreInbox(group, after, limit)
  return { items: chunk.entries, cursor: chunk.cursor }
}

const useMoreOf = (group: PagedGroup, paging: Record<PagedGroup, Paging>) => {
  const chunks = useChunks<InboxEntry, NonNullable<Paging['cursor']>>(
    paging[group].cursor,
    INBOX_PAGE,
    fetcher(group),
  )
  const left = chunks.cursor === null ? 0 : paging[group].total - paging[group].shown - chunks.items.length
  const more = { left: Math.max(0, left), loading: chunks.loading, load: chunks.load, auto: group !== 'done' }
  return { items: chunks.items, more }
}

export function usePagedGroups(paging: Record<PagedGroup, Paging>) {
  const working = useMoreOf('working', paging)
  const others = useMoreOf('others', paging)
  const done = useMoreOf('done', paging)
  const more: Partial<Record<ListGroup, More>> = {
    [LIST_OF_PAGED.working]: working.more,
    [LIST_OF_PAGED.others]: others.more,
    [LIST_OF_PAGED.done]: done.more,
  }
  return { extras: [...working.items, ...others.items, ...done.items], more }
}
