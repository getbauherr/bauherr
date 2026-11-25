import { describe, expect, it } from 'vitest'
import { addRelation, removeRelation } from '../../src/core/relations/relate'
import { isBlocked, openBlockers } from '../../src/core/relations/store'
import { RELATION_TYPES, RelationRefused, type RelationType } from '../../src/core/relations/types'
import { relationsHarness } from './relations-harness'

const { h, setup, edges } = relationsHarness('relations_store')

const ws = () => h.ids.workspace

describe('a loop of blocks', () => {
  it('is refused with a message that names the loop (c3)', async () => {
    const s = await setup()
    const [a, b, c] = [s.item(1), s.item(2), s.item(3)]
    await addRelation(h.payload(), ws(), { from: a, to: b, type: 'blocks' })
    await addRelation(h.payload(), ws(), { from: b, to: c, type: 'blocks' })
    const refused = addRelation(h.payload(), ws(), { from: c, to: a, type: 'blocks' })
    await expect(refused).rejects.toBeInstanceOf(RelationRefused)
    await expect(refused).rejects.toThrow('#3 blocks #1 blocks #2 blocks #3')
    expect(await edges()).toHaveLength(2)
  })
})

describe('a second parent', () => {
  it('is refused with a message (c4)', async () => {
    const s = await setup()
    await addRelation(h.payload(), ws(), { from: s.item(3), to: s.item(1), type: 'part-of' })
    const refused = addRelation(h.payload(), ws(), { from: s.item(3), to: s.item(2), type: 'part-of' })
    await expect(refused).rejects.toThrow('#3 already is part of #1: remove that first, a ticket has one parent.')
    expect(await edges()).toHaveLength(1)
  })
})

describe('a relation type added to the list (c6)', () => {
  const base = { blocksWork: false, loopsAllowed: false, singleParent: false, directed: true }
  const follows: RelationType = { ...base, key: 'follows', forward: 'follows', inverse: 'is followed by' }
  const twin: RelationType = {
    ...base,
    key: 'twin',
    forward: 'twins',
    inverse: 'twins',
    directed: false,
    loopsAllowed: true,
  }
  const gate: RelationType = { ...base, key: 'gates', forward: 'gates', inverse: 'is gated by', blocksWork: true }
  const parented: RelationType = { ...base, key: 'under', forward: 'is under', inverse: 'has', singleParent: true }
  const types = [...RELATION_TYPES, follows, twin, gate, parented]

  it('follows its loop rule', async () => {
    const s = await setup()
    const edge = { type: 'follows' }
    await addRelation(h.payload(), ws(), { ...edge, from: s.item(1), to: s.item(2) }, types)
    await expect(addRelation(h.payload(), ws(), { ...edge, from: s.item(2), to: s.item(1) }, types)).rejects.toThrow(
      'loop of "follows"',
    )
    await addRelation(h.payload(), ws(), { type: 'twin', from: s.item(1), to: s.item(2) }, types)
    await addRelation(h.payload(), ws(), { type: 'twin', from: s.item(2), to: s.item(1) }, types)
    expect((await edges()).filter((e) => e.type === 'twin')).toHaveLength(1)
  })

  it('follows its single-parent rule and its direction', async () => {
    const s = await setup()
    await addRelation(h.payload(), ws(), { type: 'under', from: s.item(1), to: s.item(2) }, types)
    await expect(
      addRelation(h.payload(), ws(), { type: 'under', from: s.item(1), to: s.item(3) }, types),
    ).rejects.toThrow('one parent')
    await addRelation(h.payload(), ws(), { type: 'under', from: s.item(3), to: s.item(2) }, types)
    expect((await edges()).filter((e) => e.type === 'under').map((e) => e.from)).toEqual([s.item(1), s.item(3)])
  })

  it('follows its blocks-work rule', async () => {
    const s = await setup()
    await addRelation(h.payload(), ws(), { type: 'gates', from: s.item(1), to: s.item(2) }, types)
    await addRelation(h.payload(), ws(), { type: 'follows', from: s.item(1), to: s.item(3) }, types)
    expect(await openBlockers(h.payload(), s.item(2), types)).toEqual([1])
    expect(await openBlockers(h.payload(), s.item(2))).toEqual([])
    expect(await isBlocked(h.payload(), s.item(3), types)).toBe(false)
  })

  it('refuses an unknown type', async () => {
    const s = await setup()
    await expect(
      addRelation(h.payload(), ws(), { type: 'follows', from: s.item(1), to: s.item(2) }),
    ).rejects.toThrow('Unknown relation type')
  })
})

describe('blocked', () => {
  it('is derived from open blockers of a type that blocks work', async () => {
    const s = await setup()
    await addRelation(h.payload(), ws(), { from: s.item(1), to: s.item(2), type: 'blocks' })
    await addRelation(h.payload(), ws(), { from: s.item(3), to: s.item(2), type: 'relates-to' })
    expect(await openBlockers(h.payload(), s.item(2))).toEqual([1])
    await s.tickets.close('1', 'completed')
    await s.sync()
    expect(await isBlocked(h.payload(), s.item(2))).toBe(false)
    await removeRelation(h.payload(), { from: s.item(1), to: s.item(2), type: 'blocks' })
    expect(await edges()).toHaveLength(1)
  })
})
