import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { reachOf, warningsOf } from '../../src/core/instruction-files'
import { instructionFilesOf } from '../../src/core/views/instruction-files'
import { mirrorHarness, readerOf } from './mirror-harness'

const h = mirrorHarness('core_instruction_files')

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n')

const FILES: Record<string, string> = {
  'AGENTS.md': lines(10),
  'CLAUDE.md': lines(250),
  'docs/CLAUDE.md': lines(3),
  '.ai/rules/index.md': lines(5),
  '.claude/skills/review/SKILL.md': lines(7),
  '.cursor/rules/style.mdc': lines(2),
  '.github/copilot-instructions.md': lines(4),
  'src/index.ts': 'export {}',
}

const synced = async (files: Record<string, string>, executor: 'runner' | 'session') => {
  const repo = h.fresh()
  const fake = new FakeBackend({ native: true, user: 'jo' })
  await fake.tickets(repo).create({ title: 'seed', body: '' })
  for (const [path, content] of Object.entries(files)) fake.commit(repo, 'main', path, content)
  await h.sync({ [repo]: readerOf(fake) })
  await h.rows(sql`UPDATE "products" SET "executor" = ${executor} WHERE "id" = ${h.ids.product}`)
  return instructionFilesOf(h.payload(), h.ids.workspace, h.ids.product)
}

describe('repository files that instruct agents', () => {
  it('lists every kind of file with its path, line count and how it reaches an agent', async () => {
    const view = await synced(FILES, 'session')
    expect(view.files.map(({ path, lines: n, reach }) => [path, n, reach])).toEqual([
      ['.ai/rules/index.md', 5, 'session'],
      ['.claude/skills/review/SKILL.md', 7, 'session'],
      ['.cursor/rules/style.mdc', 2, 'not-loaded'],
      ['.github/copilot-instructions.md', 4, 'not-loaded'],
      ['AGENTS.md', 10, 'handed'],
      ['CLAUDE.md', 250, 'session'],
      ['docs/CLAUDE.md', 3, 'session'],
    ])
  })

  it('shows CLAUDE.md, rules and skills as not loaded on the built-in runner', async () => {
    const view = await synced(FILES, 'runner')
    const reach = Object.fromEntries(view.files.map((file) => [file.path, file.reach]))
    expect(reach['AGENTS.md']).toBe('handed')
    expect(reach['CLAUDE.md']).toBe('not-loaded')
    expect(reach['.ai/rules/index.md']).toBe('not-loaded')
    expect(reach['.claude/skills/review/SKILL.md']).toBe('not-loaded')
  })

  it('does not hand a nested AGENTS.md', () => {
    expect(reachOf('docs/AGENTS.md', 'session')).toBe('not-loaded')
  })

  it('warns about a file over 200 lines and an AGENTS.md beyond the factory cut-off', async () => {
    const view = await synced({ 'CLAUDE.md': lines(250), 'AGENTS.md': 'x'.repeat(13_000) }, 'session')
    expect(view.files.find((file) => file.path === 'CLAUDE.md')?.warnings).toEqual(['long'])
    expect(view.files.find((file) => file.path === 'AGENTS.md')?.warnings).toEqual(['cut'])
    expect(warningsOf('AGENTS.md', 10, 12_000)).toEqual([])
  })

  it('replaces the stored list when a file disappears', async () => {
    await synced(FILES, 'session')
    const repo = h.fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    await fake.tickets(repo).create({ title: 'seed', body: '' })
    fake.commit(repo, 'main', 'CLAUDE.md', 'a')
    await h.sync({ [repo]: readerOf(fake) })
    await h.rows(sql`UPDATE "ticket_sources" SET "facts_at" = NULL`)
    await h.sync({ [repo]: readerOf(fake) })
    const view = await instructionFilesOf(h.payload(), h.ids.workspace, h.ids.product)
    expect(view.files.map((file) => file.path)).toEqual(['CLAUDE.md'])
  })
})
