'use server'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { stageSchema } from '../../../core/events'
import { laneCursor, laneMore } from '../../../core/views/board'
import type { LaneCursor } from '../../../core/views/lanes'
import { itemOf } from '../components/factory/lane-items'
import type { Item } from '../components/factory/useOrder'
import { blockingFirst } from '../lib/board-relations'
import { MAX_WINDOW } from '../lib/chunks'
import { LANE_PAGE, SHOWS } from '../lib/factory'
import { currentWorkspace, payloadClient } from '../lib/session'

const input = z.object({
  stage: stageSchema.exclude(['done']),
  show: z.enum(SHOWS),
  product: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(MAX_WINDOW).default(LANE_PAGE),
  cursor: z.object({ rank: z.number(), enteredAt: z.iso.datetime(), id: z.number().int().positive() }),
})

export async function moreCards(
  request: z.input<typeof input>,
): Promise<{ items: Item<ReactNode>[]; cursor: LaneCursor | null }> {
  const { workspace } = await currentWorkspace()
  const parsed = input.safeParse(request)
  if (!workspace || !parsed.success) return notFound()
  const { stage, show, product, cursor, limit } = parsed.data
  const filter = { workspace: workspace.id, now: new Date(), ...(product && { product }) }
  const cards = await laneMore(await payloadClient(), filter, { stage, after: cursor, limit })
  const last = cards.at(-1)
  return {
    items: blockingFirst(cards).map((card) => itemOf(card, show)),
    cursor: last && cards.length === limit ? laneCursor(last) : null,
  }
}
