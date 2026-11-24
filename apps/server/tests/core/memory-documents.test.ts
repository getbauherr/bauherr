import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Stage } from '../../src/core/events'
import type { Role } from '../../src/core/lifecycle'
import { MemoryInvalid, MemoryNotFound, NotAllowedToChangeMemory } from '../../src/core/memory'
import {
  documentVersions,
  readDocument,
  saveDocument,
  type DocumentTarget,
} from '../../src/core/memory-documents'
import { addMemory } from '../../src/core/memory-store'
import { sectionsOf } from '../../src/core/memory-sections'
import { createRecord } from '../../src/core/record/store'
import { claim, enqueue } from '../../src/core/run/leases'
import { contextPack } from '../../src/core/run/pack'
import { source } from './fixtures'
import { openEngine, type Engine } from './harness'

let e: Engine
let next = 9000

const document = (label: string) =>
  ['## All stages', `${label} all`, '## Brief', `${label} brief`, '## Build', `${label} build`, '## Review',
    `${label} review`, '## Verify', `${label} verify`, '## Notes', `${label} notes`].join('\n')

const admin = () => ({ id: 'a1', role: 'admin', workspaceIds: [] as number[] })
const bauherr = () => ({ person: e.owner, workspace: e.db.workspace })
const factory: DocumentTarget = { scope: 'factory' }
const workspace = (): DocumentTarget => ({ scope: 'workspace', workspace: e.db.workspace })
const product = (): DocumentTarget => ({ scope: 'product', workspace: e.db.workspace, product: e.db.product })

const seed = async () => {
  await saveDocument(e.db.payload, { person: admin(), workspace: e.db.workspace }, factory, document('F'))
  await saveDocument(e.db.payload, bauherr(), workspace(), document('W'))
  await saveDocument(e.db.payload, bauherr(), product(), document('P'))
}

const packOf = async (stage: Stage, role: Role) => {
  const created = await createRecord(e.db.payload, {
    workspace: e.db.workspace,
    product: e.db.product,
    source: { ...source, number: next++ },
    type: 'bug',
  })
  await e.drain()
  await enqueue(e.db.payload, created.id, { stage, role, fingerprint: `fp-${next++}` })
  const claimed = await claim(e.db.payload, { workspace: e.db.workspace, role, by: 't', now: e.clock.now })
  if (!claimed) throw new Error('no run')
  return contextPack(e.deps(), claimed.run)
}

beforeAll(async () => {
  e = await openEngine('core_memory_documents')
}, 120_000)
afterAll(async () => {
  await e?.drop()
})
beforeEach(async () => {
  await e.db.payload.db.drizzle.execute(sql`DELETE FROM "memory_document_versions"`)
  await e.db.payload.db.drizzle.execute(sql`DELETE FROM "statements"`)
})

describe('the section parser', () => {
  it('splits by the five fixed headings and drops text under any other heading', () => {
    expect(sectionsOf(`intro\n${document('X')}\n### Deeper\nkept`)).toEqual({
      'All stages': 'X all',
      Brief: 'X brief',
      Build: 'X build',
      Review: 'X review',
      Verify: 'X verify',
    })
  })
})

describe('what a run is told', () => {
  it('gives a Build run the All stages and Build parts of factory, workspace and product, in that order', async () => {
    await seed()
    const pack = await packOf('build', 'builder')
    expect(pack.memory).toEqual([
      { scope: 'factory', text: 'F all\n\nF build' },
      { scope: 'workspace', text: 'W all\n\nW build' },
      { scope: 'product', text: 'P all\n\nP build' },
    ])
  })

  it('gives a reviewer the Review parts and a verifier the Verify parts, never the unknown heading', async () => {
    await seed()
    const review = await packOf('verify', 'reviewer')
    const verify = await packOf('verify', 'verifier')
    const texts = (pack: typeof review) => pack.memory.map((part) => part.text)
    expect(texts(review)).toEqual(['F all\n\nF review', 'W all\n\nW review', 'P all\n\nP review'])
    expect(texts(verify)).toEqual(['F all\n\nF verify', 'W all\n\nW verify', 'P all\n\nP verify'])
    expect(JSON.stringify([review, verify])).not.toContain('notes')
  })

  it('still hands the old single memories after the three documents', async () => {
    await seed()
    await addMemory(e.db.payload, bauherr(), {
      product: e.db.product,
      input: { text: 'Old memory.', reach: 'always', stages: ['build'] },
    })
    const pack = await packOf('build', 'builder')
    expect(pack.memory).toHaveLength(3)
    expect(pack.statements.map((s) => s.text)).toEqual(['Old memory.'])
  })
})

describe('who may save', () => {
  it('lets only an Admin save the factory document', async () => {
    await saveDocument(e.db.payload, { person: admin(), workspace: e.db.workspace }, factory, 'ok')
    await expect(saveDocument(e.db.payload, bauherr(), factory, 'no')).rejects.toBeInstanceOf(NotAllowedToChangeMemory)
    expect(await readDocument(e.db.payload, factory)).toBe('ok')
  })

  it('lets the Bauherr and an Admin of the workspace save its workspace and product documents', async () => {
    await saveDocument(e.db.payload, bauherr(), workspace(), 'w')
    await saveDocument(e.db.payload, bauherr(), product(), 'p')
    const adminHere = { person: { ...admin(), workspaceIds: [e.db.workspace] }, workspace: e.db.workspace }
    await saveDocument(e.db.payload, adminHere, product(), 'p2')
    expect(await readDocument(e.db.payload, workspace())).toBe('w')
    expect(await readDocument(e.db.payload, product())).toBe('p2')
  })

  it('refuses a product owner and a Bauherr of another workspace, and an unknown product', async () => {
    const owner = { id: 'po', role: 'product-owner', workspaceIds: [e.db.workspace] }
    const stranger = { id: 'b2', role: 'bauherr', workspaceIds: [e.db.workspace + 1000] }
    for (const person of [owner, stranger]) {
      await expect(
        saveDocument(e.db.payload, { person, workspace: e.db.workspace }, workspace(), 'no'),
      ).rejects.toBeInstanceOf(NotAllowedToChangeMemory)
    }
    const unknown: DocumentTarget = { scope: 'product', workspace: e.db.workspace, product: e.db.product + 1000 }
    await expect(saveDocument(e.db.payload, bauherr(), unknown, 'no')).rejects.toBeInstanceOf(MemoryNotFound)
  })
})

describe('versions', () => {
  it('keeps every save with who, when and why, and earlier versions stay readable', async () => {
    await saveDocument(e.db.payload, bauherr(), product(), 'one')
    await saveDocument(e.db.payload, bauherr(), product(), 'two', 'retro')
    const versions = await documentVersions(e.db.payload, product())
    expect(versions.map((v) => [v.body, v.author, v.reason])).toEqual([
      ['two', 'u7', 'retro'],
      ['one', 'u7', 'edited'],
    ])
    expect(Number.isNaN(Date.parse(versions[0]?.at ?? ''))).toBe(false)
    expect(await readDocument(e.db.payload, product())).toBe('two')
  })
})

describe('the line limit', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')

  it('refuses 203 lines naming the 3 too many and saves 200', async () => {
    await expect(saveDocument(e.db.payload, bauherr(), workspace(), lines(203))).rejects.toThrow(/3 too many/)
    await expect(saveDocument(e.db.payload, bauherr(), workspace(), lines(203))).rejects.toBeInstanceOf(MemoryInvalid)
    await saveDocument(e.db.payload, bauherr(), workspace(), lines(200))
    expect(await documentVersions(e.db.payload, workspace())).toHaveLength(1)
  })
})
