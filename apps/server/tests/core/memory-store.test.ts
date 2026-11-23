import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ALWAYS_MAX,
  MemoryInvalid,
  MemoryNotFound,
  NotAllowedToChangeMemory,
  type MemoryInput,
  type Who,
} from '../../src/core/memory'
import { addMemory, deleteMemory, saveMemory, setMemoryOff } from '../../src/core/memory-store'
import { statementRecord } from '../../src/core/views/statement-records'
import { openEngine, type Engine } from './harness'

let e: Engine
let who: Who

beforeAll(async () => {
  e = await openEngine('core_memory_store')
  who = { person: e.owner, workspace: e.db.workspace }
  await e.db.payload.update({
    collection: 'products',
    id: e.db.product,
    data: { riskAreas: ['adapters'] },
    overrideAccess: true,
  })
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  await e.db.payload.db.drizzle.execute(sql`DELETE FROM "statements"`)
})

const input = (over: Partial<MemoryInput> = {}): MemoryInput => ({
  text: 'German texts use Sie.',
  reach: 'fit',
  stages: ['brief', 'build'],
  ...over,
})
const add = (over: Partial<MemoryInput> = {}, as: Who = who) =>
  addMemory(e.db.payload, as, { product: e.db.product, input: input(over) })
const read = async (id: number) => {
  const found = await statementRecord(e.db.payload, { workspace: e.db.workspace, id })
  if (!found) throw new Error('gone')
  return found
}
describe('adding a memory', () => {
  it('writes a written memory of the Product with the chosen place and stages, active and unedited', async () => {
    const id = await add({ reach: 'area', area: 'adapters' })
    expect(await read(id)).toMatchObject({
      kind: 'written',
      scope: 'product',
      applies: 'area',
      area: 'adapters',
      stages: ['brief', 'build'],
      off: false,
      originalText: null,
      ticket: null,
      text: 'German texts use Sie.',
    })
  })

  it('refuses an area that is not a risk area of the Product, and an area reach without an area', async () => {
    await expect(add({ reach: 'area', area: 'billing' })).rejects.toThrow(MemoryInvalid)
    await expect(add({ reach: 'area' })).rejects.toThrow(MemoryInvalid)
    await expect(add({ reach: 'ticket' })).rejects.toThrow(MemoryInvalid)
  })

  it('refuses the eleventh memory for every ticket and says to switch one off', async () => {
    for (let i = 0; i < ALWAYS_MAX; i++) await add({ reach: 'always', text: `Rule ${i}` })
    await expect(add({ reach: 'always' })).rejects.toThrow('switch one off')
    const first = z.coerce.number().parse(
      (await e.db.payload.db.drizzle.execute(sql`SELECT min("id") AS id FROM "statements"`)).rows[0]?.id,
    )
    await setMemoryOff(e.db.payload, who, { id: first, off: true })
    const eleventh = await add({ reach: 'always', text: 'Rule 11' })
    await expect(setMemoryOff(e.db.payload, who, { id: first, off: false })).rejects.toThrow('switch one off')
    await setMemoryOff(e.db.payload, who, { id: eleventh, off: true })
    await setMemoryOff(e.db.payload, who, { id: first, off: false })
    expect((await read(first)).off).toBe(false)
  })
})

describe('editing a memory', () => {
  it('keeps the text before the first edit once, however often it is edited', async () => {
    const id = await add()
    await saveMemory(e.db.payload, who, { id, input: input({ text: 'German texts use Sie, never du.' }) })
    await saveMemory(e.db.payload, who, { id, input: input({ text: 'Always Sie.', reach: 'always' }) })
    expect(await read(id)).toMatchObject({
      text: 'Always Sie.',
      originalText: 'German texts use Sie.',
      applies: 'always',
    })
  })

  it('does not call a save without a change an edit', async () => {
    const id = await add()
    await saveMemory(e.db.payload, who, { id, input: input({ stages: ['review'] }) })
    expect(await read(id)).toMatchObject({ originalText: null, stages: ['review'] })
  })

  it('refuses a ticket-only reach for a memory without a ticket', async () => {
    const id = await add()
    await expect(saveMemory(e.db.payload, who, { id, input: input({ reach: 'ticket' }) })).rejects.toThrow(
      MemoryInvalid,
    )
  })
})

describe('switching and deleting', () => {
  it('switches off and on, and deletes a memory that runs already got', async () => {
    const id = await add()
    await setMemoryOff(e.db.payload, who, { id, off: true })
    expect((await read(id)).off).toBe(true)
    await setMemoryOff(e.db.payload, who, { id, off: false })
    expect((await read(id)).off).toBe(false)
    await deleteMemory(e.db.payload, who, { id })
    expect(await statementRecord(e.db.payload, { workspace: e.db.workspace, id })).toBeNull()
  })
})

describe('who may change memory', () => {
  const change: [string, (as: Who, id: number) => Promise<unknown>][] = [
    ['add', (as) => add({}, as)],
    ['save', (as, id) => saveMemory(e.db.payload, as, { id, input: input({ text: 'Other.' }) })],
    ['switch', (as, id) => setMemoryOff(e.db.payload, as, { id, off: true })],
    ['delete', (as, id) => deleteMemory(e.db.payload, as, { id })],
  ]

  it.each(change)('refuses to %s for a person who may not decide', async (_name, act) => {
    const id = await add()
    const outsider: Who = { person: { ...e.owner, role: 'product-owner' }, workspace: e.db.workspace }
    await expect(act(outsider, id)).rejects.toThrow(NotAllowedToChangeMemory)
    expect(await read(id)).toMatchObject({ text: 'German texts use Sie.', off: false })
  })

  it.each(change)('refuses to %s for another Workspace as if the memory did not exist', async (_name, act) => {
    const id = await add()
    const other: Who = { person: { ...e.owner, workspaceIds: [e.db.workspace + 1] }, workspace: e.db.workspace + 1 }
    await expect(act(other, id)).rejects.toThrow(MemoryNotFound)
    expect(await read(id)).toMatchObject({ text: 'German texts use Sie.', off: false })
  })
})
