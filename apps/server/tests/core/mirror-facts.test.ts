import { FakeBackend } from '@bauherr/adapters'
import { describe, expect, it } from 'vitest'
import { AGENTS_FILE_MAX } from '../../src/core/mirror/facts'
import type { ForgeReader, ReadForge } from '../../src/core/forge/reader'
import { HOUR, mirrorHarness, readerOf, withTickets } from './mirror-harness'

const h = mirrorHarness('core_mirror_facts')
const { newSource, sync, source, numbersOf, fresh, settle, later } = h
const DAY = 24 * HOUR

const withForge = (reader: ForgeReader, change: Partial<ReadForge>): ForgeReader => ({
  tickets: reader.tickets,
  forge: { ...reader.forge, ...change },
})

const FACT_CALLS = ['getRepository', 'isBranchProtected', 'requiredChecks', 'fileExists', 'countIssueForms'] as const

const counting = (reader: ForgeReader) => {
  const calls: string[] = []
  const change: Partial<ReadForge> = {
    getRepository: (repo) => (calls.push('getRepository'), reader.forge.getRepository(repo)),
    isBranchProtected: (repo, branch) => {
      calls.push('isBranchProtected')
      return reader.forge.isBranchProtected(repo, branch)
    },
    requiredChecks: (repo, branch) => (calls.push('requiredChecks'), reader.forge.requiredChecks(repo, branch)),
    fileExists: (repo, path, ref) => (calls.push('fileExists'), reader.forge.fileExists(repo, path, ref)),
    countIssueForms: (repo, ref) => (calls.push('countIssueForms'), reader.forge.countIssueForms(repo, ref)),
  }
  return { reader: withForge(reader, change), calls: () => calls.filter((c) => FACT_CALLS.some((f) => f === c)) }
}

const failing = (reader: ForgeReader) =>
  withForge(reader, { isBranchProtected: () => Promise.reject(new Error('facts denied')) })

const prepared = (repo: string) => {
  const fake = new FakeBackend({ native: true, user: 'jo' })
  fake.setBranchProtected(repo, true)
  fake.setRequiredChecks(repo, ['ci', 'lint'])
  fake.commit(repo, 'main', 'AGENTS.md', 'rules')
  fake.commit(repo, 'main', '.github/ISSUE_TEMPLATE/bug.yml', 'x')
  fake.commit(repo, 'main', '.github/ISSUE_TEMPLATE/config.yml', 'x')
  fake.commit(repo, 'main', '.github/ISSUE_TEMPLATE/idea.yaml', 'x')
  return fake
}

describe('repository facts in the sync', () => {
  it('stores the facts when the source is first synced', async () => {
    const repo = fresh()
    const fake = prepared(repo)
    const id = await newSource(repo)
    await sync({ [repo]: readerOf(fake) })
    expect(await source(id)).toMatchObject({
      default_branch: 'main',
      branch_protected: 'yes',
      required_check_names: ['ci', 'lint'],
      has_agents_file: true,
      issue_form_count: '2',
    })
    expect(new Date(String((await source(id))?.facts_at))).toEqual(new Date('2026-11-19T10:00:00Z'))
  })

  it('stores the text of AGENTS.md, and cuts a long one at a line break with a flag', async () => {
    const repo = fresh()
    const fake = prepared(repo)
    const id = await newSource(repo)
    await sync({ [repo]: readerOf(fake) })
    expect(await source(id)).toMatchObject({ agents_file: 'rules', agents_file_cut: false })
    fake.commit(repo, 'main', 'AGENTS.md', `${'line\n'.repeat(3000)}tail`)
    later(DAY + HOUR)
    await sync({ [repo]: readerOf(fake) })
    const stored = await source(id)
    expect(stored?.agents_file_cut).toBe(true)
    expect(String(stored?.agents_file)).toHaveLength(AGENTS_FILE_MAX - (AGENTS_FILE_MAX % 5) - 1)
    expect(String(stored?.agents_file).endsWith('line')).toBe(true)
  })

  it('stores no text when the repository has no AGENTS.md', async () => {
    const repo = fresh()
    const id = await newSource(repo)
    await sync({ [repo]: readerOf(new FakeBackend({ native: true, user: 'jo' })) })
    expect(await source(id)).toMatchObject({ agents_file: null, agents_file_cut: false })
  })

  it('stores no, and unknown when the forge cannot say', async () => {
    const repo = fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    const id = await newSource(repo)
    await sync({ [repo]: readerOf(fake) })
    expect(await source(id)).toMatchObject({
      branch_protected: 'no', required_check_names: [], has_agents_file: false, issue_form_count: '0',
    })
    fake.setBranchProtected(repo, null)
    later(DAY + HOUR)
    await settle({ [repo]: readerOf(fake) })
    expect((await source(id))?.branch_protected).toBe('unknown')
  })

  it('reads the facts once a day: five forge calls per source, refreshed by the reconcile', async () => {
    const repo = fresh()
    const fake = prepared(repo)
    const id = await newSource(repo)
    const watched = counting(readerOf(fake))
    const readers = { [repo]: watched.reader }
    await settle(readers)
    await sync(readers)
    const before = watched.calls().length
    fake.setBranchProtected(repo, false)
    fake.setRequiredChecks(repo, [])
    for (let i = 0; i < 4; i++) {
      later(HOUR)
      await sync(readers)
    }
    expect(watched.calls().length).toBe(before)
    expect((await source(id))?.branch_protected).toBe('yes')
    later(DAY)
    await sync(readers)
    expect(watched.calls().length - before).toBe(5)
    expect(await source(id)).toMatchObject({ branch_protected: 'no', required_check_names: [] })
  })

  it('keeps the old facts and notes the error when the facts cannot be read, and still syncs issues', async () => {
    const repo = fresh()
    const fake = prepared(repo)
    const id = await newSource(repo)
    await settle({ [repo]: readerOf(fake) })
    await sync({ [repo]: readerOf(fake) })
    const stored = await source(id)
    await fake.tickets(repo).create({ title: 'later' })
    later(DAY + HOUR)
    const result = await sync({ [repo]: failing(readerOf(fake)) })
    const after = await source(id)
    expect(result).toEqual({ synced: 1, failed: 0 })
    expect(await numbersOf(repo)).toEqual([1])
    expect(after).toMatchObject({
      branch_protected: 'yes', required_check_names: ['ci', 'lint'], facts_at: stored?.facts_at,
    })
    expect(after?.last_error).toContain('facts denied')
    later(HOUR)
    await sync({ [repo]: readerOf(fake) })
    expect((await source(id))?.last_error).toBeNull()
  })

  it('stores no facts but all issues when the first read fails', async () => {
    const repo = fresh()
    const fake = prepared(repo)
    await fake.tickets(repo).create({ title: 'one' })
    const id = await newSource(repo)
    await sync({ [repo]: failing(readerOf(fake)) })
    expect(await numbersOf(repo)).toEqual([1])
    expect(await source(id)).toMatchObject({ branch_protected: null, facts_at: null })
  })

  it('leaves a sync error in place instead of the facts error', async () => {
    const repo = fresh()
    const fake = prepared(repo)
    const id = await newSource(repo)
    const broken = withTickets(failing(readerOf(fake)), { poll: () => Promise.reject(new Error('poll failed')) })
    expect(await sync({ [repo]: broken })).toEqual({ synced: 0, failed: 1 })
    expect((await source(id))?.last_error).toBe('poll failed')
  })
})
