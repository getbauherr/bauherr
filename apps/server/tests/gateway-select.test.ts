import type { Payload } from 'payload'
import { expect, it, vi } from 'vitest'
import { tierModels } from '../src/lib/gateway'

it('reads Connections with a select, so old migrations stay independent of later columns', async () => {
  const find = vi.fn().mockResolvedValue({ docs: [{ provider: 'anthropic', slug: 'a' }] })
  await tierModels({ find } as unknown as Payload, { id: 1, slug: 'w' })
  expect(find).toHaveBeenCalledWith(expect.objectContaining({ collection: 'connections', select: { provider: true, slug: true } }))
})
