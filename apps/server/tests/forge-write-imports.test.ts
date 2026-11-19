import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const src = join(fileURLToPath(new URL('..', import.meta.url)), 'src')
const BUILDS = /\b(?:backendFor|GithubBackend|GitlabBackend|FakeBackend)\b/

const LEGACY_READERS = [
  'app/(app)/(shell)/settings/actions.ts',
  'app/(app)/lib/settings.ts',
  'lib/adapters.ts',
  'lib/fake-forge.ts',
  'lib/forge.ts',
  'lib/knowledge.ts',
]

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return files(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })

const mentions = files(src)
  .map((file) => relative(src, file).split(sep).join('/'))
  .filter((file) => !file.startsWith('core/forge/'))
  .filter((file) => BUILDS.test(readFileSync(join(src, file), 'utf8')))

it('lets no file outside core/forge name a forge backend constructor or backendFor, except the legacy readers', () => {
  expect(mentions.filter((file) => !LEGACY_READERS.includes(file))).toEqual([])
})

it('keeps the legacy list honest: every file on it still needs to be there', () => {
  expect(LEGACY_READERS.filter((file) => !mentions.includes(file))).toEqual([])
})
