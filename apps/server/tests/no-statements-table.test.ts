import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const SERVER_SRC = join(__dirname, '..', 'src')

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  )

it('has no code outside the migrations that names the dropped statements table', () => {
  const hits = files(SERVER_SRC)
    .filter((path) => !path.includes('/migrations/'))
    .filter((path) => /\bstatements\b/i.test(readFileSync(path, 'utf8')))
  expect(hits).toEqual([])
})
