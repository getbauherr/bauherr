'use server'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { z } from 'zod'
import type { RequestCursor } from '../../../../core/views/request-list'
import { REQUEST_FILTERS } from '../../../../core/views/request-status'
import { isBauherr } from '../../../../lib/people'
import { RequestRow } from '../../components/request/RequestRows'
import { payloadClient } from '../../lib/session'
import { readableProducts, requestChunk, requireRequestsReader, viewerOf } from '../../lib/requests'

const input = z.object({
  product: z.number().int().positive(),
  show: z.enum(REQUEST_FILTERS),
  cursor: z.object({ changedAt: z.iso.datetime(), id: z.number().int().positive() }),
})

export async function moreRequests(
  request: z.input<typeof input>,
): Promise<{ rows: ReactNode[]; cursor: RequestCursor | null }> {
  const person = await requireRequestsReader()
  const parsed = input.safeParse(request)
  if (!parsed.success) return notFound()
  const payload = await payloadClient()
  const product = (await readableProducts(payload, person)).find((p) => p.id === parsed.data.product)
  if (!product) return notFound()
  const { list, cursor } = await requestChunk(payload, {
    product,
    viewer: await viewerOf(payload, person),
    show: parsed.data.show,
    after: parsed.data.cursor,
  })
  const staff = isBauherr(person)
  return { rows: list.map((item) => <RequestRow key={item.row.recordId} item={item} staff={staff} />), cursor }
}
