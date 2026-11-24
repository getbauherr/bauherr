import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createRecord, readRecord } from '../../src/core/record/store'
import { loadTicketRefs, resolveMention, type TicketRefs } from '../../src/core/views/refs'
import { source } from './fixtures'
import { mirrorSource } from './scenario'
import { openViews, seed, type Seeded } from './views-harness'

let s: Seeded
let refs: TicketRefs
let repo: string
let number: number
let queries: number

beforeAll(async () => {
  s = await seed(await openViews('core_ticket_refs'))
  const { payload, workspace } = s.e.db
  const source = (await readRecord(payload, s.names.briefCard)).record.source
  repo = source.repo
  number = source.number
  await s.item(7001, { kind: 'pr', title: 'Fix it', closes: [number] })
  await s.item(7002, { kind: 'pr', title: 'Unrelated', closes: [] })
  const execute = payload.db.drizzle.execute.bind(payload.db.drizzle)
  const spy = vi.spyOn(payload.db.drizzle, 'execute').mockImplementation((query) => {
    queries += 1
    return execute(query)
  })
  queries = 0
  refs = await loadTicketRefs(payload, workspace)
  spy.mockRestore()
}, 240_000)
afterAll(async () => {
  await s?.e.drop()
})

describe('loadTicketRefs', () => {
  it('resolves a number in the ticket repo to its title and stage with one query and no forge call', () => {
    expect(queries).toBe(1)
    expect(resolveMention(refs, repo, number)).toMatchObject({
      recordId: s.names.briefCard,
      number,
      title: `Ticket ${number}`,
      stage: 'brief',
    })
  })

  it('leaves an unknown number, another repo and another workspace unresolved', () => {
    expect(resolveMention(refs, repo, 9999)).toBeNull()
    expect(resolveMention(refs, 'other/repo', number)).toBeNull()
    expect(refs.byId.has(s.names.foreign)).toBe(false)
  })

  it('resolves a pull request number to the ticket it closes and leaves one that closes nothing plain', () => {
    expect(resolveMention(refs, repo, 7001)).toMatchObject({ recordId: s.names.briefCard, number })
    expect(resolveMention(refs, repo, 7002)).toBeNull()
  })

  it('on GitLab maps #N to the issue and only !N to the ticket the merge request closes', async () => {
    const { payload, workspace, product } = s.e.db
    const lab = { ...source, forge: 'gitlab' as const, repo: 'acme/lab' }
    const ids: number[] = []
    for (const issue of [5, 7]) {
      const input = { workspace, product, source: { ...lab, number: issue }, type: 'change' as const }
      ids.push((await createRecord(payload, input)).id)
    }
    const mirror = await mirrorSource(s.e, 'acme/lab')
    await mirror.item(7, { title: 'Issue seven' })
    await mirror.item(5, { kind: 'pr', title: 'MR five', closes: [7] })
    const found = await loadTicketRefs(payload, workspace)
    expect(resolveMention(found, 'acme/lab', 5)).toMatchObject({ recordId: ids[0], number: 5 })
    expect(resolveMention(found, 'acme/lab', 5, '!')).toMatchObject({ recordId: ids[1], number: 7 })
  })
})
