import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { MergedTicket } from '../../src/core/releases/merged'
import {
  addItem,
  editItem,
  readNotes,
  removeItem,
  UNRELEASED,
  writeNotesFor,
} from '../../src/core/releases/notes-store'
import { mirrorHarness } from './mirror-harness'

const h = mirrorHarness('core_release_notes')

const ticket = async (number: number, title: string, type = 'change', visible = true): Promise<MergedTicket> => {
  const tag = visible ? 'visible' : 'internal'
  const data = JSON.stringify({ type, goal: title, result: { changes: [{ text: `${title} works.`, tag }] } })
  const found = await h.rows(sql`
    INSERT INTO "records" ("workspace_id", "product_id", "source_forge", "source_repo", "source_number", "stage",
      "waiting_on", "rank", "version", "data", "updated_at", "created_at")
    VALUES (${h.ids.workspace}, ${h.ids.product}, 'github', 'o/r', ${number}, 'ship', 'nobody', 0, 1, ${data}::jsonb,
      now(), now()) RETURNING "id"`)
  return {
    recordId: z.coerce.number().parse(found[0]?.id),
    number,
    title,
    mergedAt: '2026-11-25T10:00:00Z',
    visible,
    acceptedAt: null,
  }
}

const at = () => ({ workspace: h.ids.workspace, product: h.ids.product, version: UNRELEASED })
const junk = () => Promise.resolve('not json')
const read = async () => (await readNotes(h.payload(), h.ids.product, UNRELEASED))?.items ?? []

beforeEach(async () => {
  await h.rows(sql`DELETE FROM "release_notes"`)
  await h.rows(sql`DELETE FROM "records"`)
})

describe('release notes store', () => {
  it('keeps an edited item, an added item and a removed item when the notes are written again', async () => {
    const first = [
      await ticket(1, 'Memory as documents'),
      await ticket(2, 'Plans as pictures'),
      await ticket(3, 'Repository check'),
    ]
    await writeNotesFor(h.payload(), at(), first, junk)
    const written = await read()
    expect(written).toHaveLength(3)
    const [one, two] = written
    if (!one || !two) throw new Error('items expected')
    const edit = { title: 'Memory documents', text: 'You own the three memory documents.', area: 'Memory' }
    await editItem(h.payload(), at(), one.id, edit)
    await removeItem(h.payload(), at(), two.id)
    const added = { title: '', text: 'Sign-in works again after a reset.', area: 'Settings' }
    await addItem(h.payload(), at(), 'fixed', added)
    const changed = [...first, await ticket(4, 'Release notes for people')]
    await writeNotesFor(h.payload(), at(), changed, junk)
    const after = await read()
    const visible = after.filter((entry) => !entry.removed)
    expect(visible.find((entry) => entry.id === one.id)?.text).toBe('You own the three memory documents.')
    expect(visible.some((entry) => entry.added && entry.text === 'Sign-in works again after a reset.')).toBe(true)
    expect(visible.some((entry) => entry.tickets.includes(2))).toBe(false)
    expect(after.some((entry) => entry.id === two.id && entry.removed)).toBe(true)
    expect(visible.some((entry) => entry.tickets.includes(4))).toBe(true)
    expect(visible.filter((entry) => entry.tickets.includes(1))).toHaveLength(1)
    expect(visible.filter((entry) => entry.tickets.includes(3))).toHaveLength(1)
  })

  it('stores nothing visible for an internal-only release and counts the internal changes', async () => {
    const internal = await ticket(1, 'Rename a module', 'chore', false)
    await writeNotesFor(h.payload(), at(), [internal], junk)
    const stored = await readNotes(h.payload(), h.ids.product, UNRELEASED)
    expect(stored?.items).toEqual([])
    expect(stored?.internal).toBe(1)
  })
})
