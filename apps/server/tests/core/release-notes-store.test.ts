import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { MergedTicket } from '../../src/core/releases/merged'
import {
  addItem,
  editItem,
  readNotes,
  removeItem,
  ticketFacts,
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
    await addItem(h.payload(), at(), 'fixed', added, [1, 2, 3])
    const changed = [...first, await ticket(4, 'Release notes for people')]
    await writeNotesFor(h.payload(), at(), changed, junk)
    const after = await read()
    const visible = after.filter((entry) => !entry.removed)
    const generated = visible.filter((entry) => !entry.added)
    expect(visible.find((entry) => entry.id === one.id)?.text).toBe('You own the three memory documents.')
    expect(visible.some((entry) => entry.added && entry.text === 'Sign-in works again after a reset.')).toBe(true)
    expect(generated.some((entry) => entry.tickets.includes(2))).toBe(false)
    expect(after.some((entry) => entry.id === two.id && entry.removed)).toBe(true)
    expect(generated.some((entry) => entry.tickets.includes(4))).toBe(true)
    expect(generated.filter((entry) => entry.tickets.includes(1))).toHaveLength(1)
    expect(generated.filter((entry) => entry.tickets.includes(3))).toHaveLength(1)
  })

  it('stores nothing visible for an internal-only release and counts the internal changes', async () => {
    const internal = await ticket(1, 'Rename a module', 'chore', false)
    await writeNotesFor(h.payload(), at(), [internal], junk)
    const stored = await readNotes(h.payload(), h.ids.product, UNRELEASED)
    expect(stored?.items).toEqual([])
    expect(stored?.internal).toBe(1)
  })

  it('f2: rejects an edited title shorter than two words', async () => {
    await writeNotesFor(h.payload(), at(), [await ticket(1, 'Memory as documents')], junk)
    const [one] = await read()
    const edit = { title: 'Docs', text: 'You own them.', area: 'Memory' }
    await editItem(h.payload(), at(), one?.id ?? '', edit)
    expect((await read())[0]?.title).toBe(one?.title)
    await editItem(h.payload(), at(), one?.id ?? '', { ...edit, title: 'Memory docs' })
    expect((await read())[0]?.title).toBe('Memory docs')
  })

  it('f3: a repo-qualified reference does not fold a fix into a feature', async () => {
    const feature = await ticket(1, 'Show reports')
    const fix = await ticket(2, 'Fix reports', 'bug')
    const source = await h.newSource('o/r')
    const insert = (body: string) => h.rows(sql`
      INSERT INTO "mirror_items" ("workspace_id", "source_id", "product_id", "repo", "number", "kind", "title", "body",
        "state", "author", "author_trusted", "author_is_bot", "labels", "assignees", "url", "forge_created_at",
        "forge_updated_at", "head_sha", "closes", "draft", "synced_at", "updated_at", "created_at")
      VALUES (${h.ids.workspace}, ${source}, ${h.ids.product}, 'o/r', 2, 'issue', 'Fix reports', ${body}, 'closed',
        'jo', true, false, '[]'::jsonb, '[]'::jsonb, 'https://forge/x', now(), now(), '', '[]'::jsonb, false, now(),
        now(), now())`)
    await insert('Same bug as other/repo#1')
    expect((await ticketFacts(h.payload(), [feature, fix]))[1]?.names).toEqual([])
    await h.rows(sql`DELETE FROM "mirror_items"`)
    await insert('Same bug as other/repo#1 and fixes #1')
    expect((await ticketFacts(h.payload(), [feature, fix]))[1]?.names).toEqual([1])
  })

  it('f1: an added item does not carry into the next release', async () => {
    await writeNotesFor(h.payload(), at(), [await ticket(1, 'Memory as documents')], junk)
    await addItem(h.payload(), at(), 'fixed', { title: '', text: 'Sign-in works again.', area: 'Settings' }, [1])
    await writeNotesFor(h.payload(), at(), [await ticket(9, 'Plans as pictures')], junk)
    const texts = (await read()).map((entry) => entry.text)
    expect(texts).not.toContain('Sign-in works again.')
  })
})
