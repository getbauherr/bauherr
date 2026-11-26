'use server'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { INBOX_GROUPS, inboxMore, type InboxCursor } from '../../../../core/views/inbox'
import { InboxRow, rowKeyOf } from '../../components/inbox/InboxRow'
import { INBOX_PAGE } from '../../lib/inbox'
import { currentWorkspace, payloadClient } from '../../lib/session'

const input = z.object({
  group: z.enum(INBOX_GROUPS).exclude(['you']),
  cursor: z.object({ updatedAt: z.iso.datetime(), id: z.number().int().positive() }),
})

export async function moreInbox(
  group: string,
  cursor: InboxCursor,
): Promise<{ rows: ReactNode[]; cursor: InboxCursor | null }> {
  const { workspace } = await currentWorkspace()
  const parsed = input.safeParse({ group, cursor })
  if (!workspace || !parsed.success) return notFound()
  const chunk = await inboxMore(await payloadClient(), { workspace: workspace.id, now: new Date() }, {
    group: parsed.data.group,
    after: parsed.data.cursor,
    limit: INBOX_PAGE,
  })
  const rows = chunk.cards.map((card) => {
    const row = { kind: 'ticket', card } as const
    return <li key={rowKeyOf(row)}><InboxRow row={row} /></li>
  })
  return { rows, cursor: rows.length === INBOX_PAGE ? chunk.cursor : null }
}
