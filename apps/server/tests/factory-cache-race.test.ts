import type { Payload } from 'payload'
import { expect, it } from 'vitest'

it('a load that started before an apply cannot overwrite the cache the apply invalidated', async () => {
  const { loadWorkflows, invalidateWorkflows } = await import('../src/lib/factory')
  let release!: (v: { rows: unknown[] }) => void
  let reads = 0
  const payload = { db: { drizzle: { execute: () => (reads++, new Promise((r) => (release = r))) } } } as unknown as Payload
  const load = loadWorkflows(payload) // reads the old version ...
  invalidateWorkflows() // ... an apply commits and invalidates while the read is in flight ...
  release({ rows: [] })
  await load
  const again = loadWorkflows(payload) // ... so the next call must read the database again, not trust the stale result for 5 s
  expect(reads).toBe(2)
  release({ rows: [] })
  await again
})
