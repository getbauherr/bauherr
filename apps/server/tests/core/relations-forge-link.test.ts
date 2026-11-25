import { FakeBackend, GithubError } from '@bauherr/adapters'
import { describe, expect, it, vi } from 'vitest'
import { ForgeUnavailable, syncForgeLink } from '../../src/core/relations/forge-link'
import { typeOf } from '../../src/core/relations/types'

const blocks = typeOf('blocks')
const link = { field: 'blockedBy' as const, mine: 3, other: 2 }
const down = () => new GithubError(500, 'POST', '/repos/o/r/issues/3/dependencies/blocked_by', '')

const forge = async () => {
  const tickets = new FakeBackend({ native: true, user: 'jo' }).tickets('o/r')
  for (const title of ['one', 'two', 'three']) await tickets.create({ title })
  const real = tickets.addBlockedBy.bind(tickets)
  const add = vi.spyOn(tickets, 'addBlockedBy')
  return { tickets, add, real }
}

describe('a forge link write that GitHub answers with a server error', () => {
  it('counts as done when the link is there after the error', async () => {
    const f = await forge()
    f.add.mockImplementationOnce(async (id, blocker) => {
      await f.real(id, blocker)
      throw down()
    })
    await syncForgeLink(f.tickets, blocks, link, 'add')
    expect(f.add).toHaveBeenCalledTimes(1)
    expect((await f.tickets.get('3')).blockedBy).toEqual(['2'])
  })

  it('is tried once more and then succeeds', async () => {
    const f = await forge()
    f.add.mockRejectedValueOnce(down())
    await syncForgeLink(f.tickets, blocks, link, 'add')
    expect(f.add).toHaveBeenCalledTimes(2)
    expect((await f.tickets.get('3')).blockedBy).toEqual(['2'])
  })

  it('ends in a message the page can show after the second error', async () => {
    const f = await forge()
    f.add.mockRejectedValue(down())
    await expect(syncForgeLink(f.tickets, blocks, link, 'add')).rejects.toBeInstanceOf(ForgeUnavailable)
    expect(f.add).toHaveBeenCalledTimes(2)
  })

  it('passes any other error on unchanged', async () => {
    const f = await forge()
    const refused = new GithubError(422, 'POST', '/x', 'cycle')
    f.add.mockRejectedValue(refused)
    await expect(syncForgeLink(f.tickets, blocks, link, 'add')).rejects.toBe(refused)
    expect(f.add).toHaveBeenCalledTimes(1)
  })
})
