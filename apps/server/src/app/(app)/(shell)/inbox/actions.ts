'use server'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { INBOX_GROUPS, inboxMore, type InboxCursor } from '../../../../core/views/inbox'
import { MAX_WINDOW } from '../../lib/chunks'
import { entryOfCard, INBOX_PAGE, type InboxEntry } from '../../lib/inbox-entries'
import { currentWorkspace, payloadClient } from '../../lib/session'

const input = z.object({
  group: z.enum(INBOX_GROUPS).exclude(['you']),
  limit: z.number().int().min(1).max(MAX_WINDOW),
  cursor: z.object({ updatedAt: z.iso.datetime(), id: z.number().int().positive() }),
})

export async function moreInbox(
  group: string,
  cursor: InboxCursor,
  limit = INBOX_PAGE,
): Promise<{ entries: InboxEntry[]; cursor: InboxCursor | null }> {
  const { workspace } = await currentWorkspace()
  const parsed = input.safeParse({ group, cursor, limit })
  if (!workspace || !parsed.success) return notFound()
  const chunk = await inboxMore(await payloadClient(), { workspace: workspace.id, now: new Date() }, {
    group: parsed.data.group,
    after: parsed.data.cursor,
    limit: parsed.data.limit,
  })
  const entries = chunk.cards.map((card) => entryOfCard(card, parsed.data.group))
  return { entries, cursor: entries.length === parsed.data.limit ? chunk.cursor : null }
}
