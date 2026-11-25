import { describe, expect, it, vi } from 'vitest'
import { forgeText, nothingVisible } from '../../src/core/releases/forge-text'
import {
  classify,
  generate,
  limitNotes,
  MAX_FIXED,
  MAX_NEW,
  mergeNotes,
  plainNotes,
  type NoteItem,
  type TicketFacts,
} from '../../src/core/releases/notes'
import { isArea } from '../../src/core/releases/notes-areas'

const fact = (number: number, extra: Partial<TicketFacts> = {}): TicketFacts => ({
  number,
  title: `Show the report ${number} to people`,
  visible: true,
  bug: false,
  goal: '',
  changes: [`People see report ${number} in the list.`],
  areas: [],
  names: [],
  ...extra,
})

const count = (text: string) => text.split(/\s+/).filter(Boolean).length

const within = (items: NoteItem[]) => {
  expect(items.filter((i) => i.kind === 'new').length).toBeLessThanOrEqual(MAX_NEW)
  expect(items.filter((i) => i.kind === 'fixed').length).toBeLessThanOrEqual(MAX_FIXED)
  for (const entry of items) {
    expect(isArea(entry.area)).toBe(true)
    expect(count(entry.text)).toBeLessThanOrEqual(20)
    if (entry.kind === 'new') {
      expect(count(entry.title ?? '')).toBeGreaterThanOrEqual(2)
      expect(count(entry.title ?? '')).toBeLessThanOrEqual(4)
    } else {
      expect(entry.title).toBeNull()
    }
  }
}

const answer = (items: unknown[]) => JSON.stringify({ items })

describe('release notes', () => {
  it('lists visible changes only, counts internal ones, says nothing visible when all are internal', async () => {
    const mixed = classify([fact(1), fact(2, { visible: false }), fact(3, { visible: false }), fact(4)])
    expect(mixed.listed.map((entry) => entry.number)).toEqual([1, 4])
    expect(mixed.internal).toBe(2)
    const ask = vi.fn()
    const only = classify([fact(5, { visible: false }), fact(6, { visible: false })])
    expect(await generate(only, ask)).toEqual([])
    expect(ask).not.toHaveBeenCalled()
    expect(only.internal).toBe(2)
    const text = forgeText([], only.internal, 'https://bauherr.example/releases')
    expect(text).toContain('Nothing visible to users in this version; 2 internal changes not listed.')
    expect(nothingVisible(0)).toBe('Nothing visible to users in this version.')
  })

  it('enforces the limits on over-long model output and gives every item an area', () => {
    const features = Array.from({ length: 8 }, (_, i) => fact(i + 1))
    const fixes = Array.from({ length: 5 }, (_, i) => fact(i + 20, { bug: true }))
    const classified = classify([...features, ...fixes])
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    const raw = answer([
      ...features.map((f, i) => ({
        kind: 'new',
        area: i % 2 ? 'Nonsense' : undefined,
        title: i === 0 ? 'One' : 'A very long title with far too many words',
        text: long,
        tickets: [f.number],
      })),
      ...fixes.map((f) => ({ kind: 'fixed', area: 'Tickets', title: 'ignored', text: long, tickets: [f.number] })),
    ])
    const items = limitNotes(raw, classified)
    expect(items).not.toBeNull()
    expect(items?.filter((i) => i.kind === 'new')).toHaveLength(MAX_NEW)
    expect(items?.filter((i) => i.kind === 'fixed')).toHaveLength(MAX_FIXED)
    within(items ?? [])
  })

  it('keeps a fix that names a feature of the same release out of Fixed', async () => {
    const tickets = [
      fact(1, { title: 'Memory as documents' }),
      fact(2, { bug: true, names: [1], changes: ['The documents save again.'] }),
      fact(3, { bug: true, changes: ['Exports work again.'] }),
    ]
    const classified = classify(tickets)
    expect(classified.listed.map((entry) => entry.number)).toEqual([1, 3])
    expect(classified.listed[0]?.followUps).toEqual([2])
    const raw = answer([
      {
        kind: 'new',
        area: 'Memory',
        title: 'Memory as documents',
        text: 'You keep memory in documents.',
        tickets: [1],
      },
      { kind: 'fixed', area: 'Memory', title: null, text: 'The documents save again.', tickets: [2] },
      { kind: 'fixed', area: 'Factory', title: null, text: 'Exports work again.', tickets: [3] },
    ])
    const down = await generate(classified, () => Promise.reject(new Error('gateway down')))
    for (const items of [limitNotes(raw, classified), down]) {
      const fixed = items?.filter((i) => i.kind === 'fixed') ?? []
      expect(fixed.map((i) => i.tickets)).toEqual([[3]])
      expect(items?.find((i) => i.kind === 'new')?.tickets).toEqual([1, 2])
    }
  })

  it('falls back to the plain list when the model throws, returns junk or returns nothing usable', async () => {
    const classified = classify([
      fact(1, { changes: ['Contact jo@example.com, see https://x.test or @jo. Closes #9 now.'] }),
      ...Array.from({ length: 7 }, (_, i) => fact(i + 2)),
      ...Array.from({ length: 4 }, (_, i) => fact(i + 30, { bug: true })),
    ])
    for (const ask of [
      () => Promise.reject(new Error('gateway down')),
      () => Promise.resolve('this is not json {'),
      () => Promise.resolve(answer([])),
      () => Promise.resolve(answer([{ kind: 'new', text: '', tickets: [999] }])),
    ]) {
      const items = await generate(classified, ask)
      expect(items.length).toBeGreaterThan(0)
      within(items)
      for (const entry of items) expect(entry.text).not.toMatch(/@|https?:|#\d/)
    }
    expect(plainNotes(classified)).toHaveLength(MAX_NEW + MAX_FIXED)
  })

  it('renders the forge text with one emoji per section and area, bold titles and a final link', () => {
    const item = (extra: Partial<NoteItem>): NoteItem => ({
      id: 'x',
      kind: 'new',
      area: 'Memory',
      title: 'Memory as documents',
      text: 'You keep what the factory remembers in three documents.',
      tickets: [1],
      edited: false,
      added: false,
      removed: false,
      ...extra,
    })
    const text = forgeText(
      [
        item({}),
        item({ id: 'y', kind: 'fixed', area: 'Factory', title: null, text: 'Tickets with a conflict no longer wait.' }),
        item({ id: 'z', title: 'Gone', removed: true }),
      ],
      3,
      'https://bauherr.example/releases?product=1',
    )
    expect(text).toBe(
      [
        '## ✨ New and improved',
        '',
        '- **Memory as documents** (🔖 Memory): You keep what the factory remembers in three documents.',
        '',
        '## 🔧 Fixed',
        '',
        '- (🏭 Factory): Tickets with a conflict no longer wait.',
        '',
        '[Read the full release notes in Bauherr](https://bauherr.example/releases?product=1)',
      ].join('\n'),
    )
  })

  it('neutralises mentions, closing keywords, links and HTML in text that goes to the forge', () => {
    const text = forgeText(
      [
        {
          id: 'x',
          kind: 'new',
          area: 'Tickets',
          title: 'Plans',
          text: 'Thanks @someone, Closes #3 [click](https://evil.test) <img src=x>',
          tickets: [1],
          edited: true,
          added: false,
          removed: false,
        },
      ],
      0,
      'https://bauherr.example/releases',
    )
    expect(text).not.toMatch(/@(?!​)/)
    expect(text).not.toMatch(/Closes #3/)
    expect(text).toContain('\\<img')
    expect(text).toContain('\\[click\\]\\(')
  })

  it('f1: drops edits whose tickets left the release, drops added items of an earlier release', () => {
    const base = { kind: 'new' as const, area: 'Tickets' as const, title: 'A title', text: 'Text.', removed: false }
    const edited = { ...base, id: 'e', tickets: [5], edited: true, added: false }
    const added = { ...base, id: 'a', tickets: [5], edited: false, added: true }
    const fresh = plainNotes(classify([fact(9)]))
    expect(mergeNotes([edited, added], fresh, [9]).map((entry) => entry.id)).toEqual([fresh[0]?.id])
    expect(mergeNotes([added], [], [5]).map((entry) => entry.id)).toEqual(['a'])
    expect(mergeNotes([edited], [], [5, 9]).map((entry) => entry.id)).toEqual(['e'])
  })

  it('f2: generated titles have at least two words', () => {
    const [entry] = plainNotes(classify([fact(12, { title: '#12', changes: [], goal: '' })]))
    expect(count(entry?.title ?? '')).toBeGreaterThanOrEqual(2)
  })

  it('f4: the section follows the ticket type, not the model answer', () => {
    const classified = classify([fact(1), fact(2, { bug: true })])
    const items = limitNotes(
      answer([
        { kind: 'fixed', area: 'Tickets', title: null, text: 'Reports show.', tickets: [1] },
        { kind: 'new', area: 'Tickets', title: 'Bug gone now', text: 'It works.', tickets: [2] },
      ]),
      classified,
    )
    expect(items?.map((entry) => [entry.kind, entry.tickets])).toEqual([
      ['new', [1]],
      ['fixed', [2]],
    ])
  })

  it('f5: a ticket cut from a mixed item lands in its own item', () => {
    const classified = classify([fact(1), fact(2, { bug: true })])
    const items = limitNotes(
      answer([{ kind: 'new', area: 'Tickets', title: 'Reports and fix', text: 'Both.', tickets: [1, 2] }]),
      classified,
    )
    expect(items?.map((entry) => [entry.kind, entry.tickets])).toEqual([
      ['new', [1]],
      ['fixed', [2]],
    ])
  })
})
