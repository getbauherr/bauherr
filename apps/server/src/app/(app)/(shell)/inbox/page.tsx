import type { Payload } from 'payload'
import { isProductOwner } from '../../../../lib/people'
import { heldOf } from '../../../../core/views/board'
import { loadInbox } from '../../../../core/views/inbox'
import { RecordNotFound } from '../../../../core/record/errors'
import { agentSessions } from '../../../../core/views/sessions'
import { ticket } from '../../../../core/views/ticket'
import { AutoRefresh } from '../../components/AutoRefresh'
import { EmptyState } from '../../components/EmptyState'
import { InboxView } from '../../components/inbox/InboxView'
import { BOARD_TABLES } from '../../lib/change-tables'
import { defaultSelection, INBOX_FIRST, listOf, pagingOf, type InboxEntry } from '../../lib/inbox-entries'
import { emptyThread, sessionThread, unreadableThread, threadOf, type ThreadModel } from '../../lib/inbox-thread'
import { ticketRefs } from '../../lib/refs'
import { currentWorkspace, payloadClient } from '../../lib/session'

export const dynamic = 'force-dynamic'

type Search = Promise<{ t?: string | string[] }>

const threadFor = async (
  payload: Payload,
  workspace: number,
  selected: string | null,
  entries: InboxEntry[],
): Promise<ThreadModel> => {
  if (selected === null) return emptyThread()
  const entry = entries.find((candidate) => candidate.id === selected)
  if (entry?.kind === 'session') return sessionThread(entry)
  const recordId = Number(selected)
  if (!Number.isInteger(recordId) || recordId <= 0) return emptyThread()
  try {
    return threadOf(await ticket(payload, { workspace, recordId }), await ticketRefs())
  } catch (error) {
    if (error instanceof RecordNotFound) return emptyThread()
    return unreadableThread(entries.find((candidate) => candidate.id === selected))
  }
}

export default async function Inbox({ searchParams }: { searchParams: Search }) {
  const { user, workspace } = await currentWorkspace()
  if (!workspace || isProductOwner(user)) return <EmptyState text="You have no Workspace yet." />
  const payload = await payloadClient()
  const filter = { workspace: workspace.id, now: new Date() }
  const [chunks, held, sessions] = await Promise.all([
    loadInbox(payload, filter, INBOX_FIRST),
    heldOf(payload, filter),
    agentSessions(payload, { workspace: workspace.id, owner: Number(user.id), now: filter.now }),
  ])
  const entries = listOf({ chunks, sessions, held })
  const { t } = await searchParams
  const asked = typeof t === 'string' && t !== '' ? t : null
  const thread = await threadFor(payload, workspace.id, asked ?? defaultSelection(entries), entries)
  return (
    <>
      <h1 className="sr-only">Inbox</h1>
      <InboxView entries={entries} paging={pagingOf(chunks)} thread={thread} />
      <AutoRefresh tables={BOARD_TABLES} />
    </>
  )
}
