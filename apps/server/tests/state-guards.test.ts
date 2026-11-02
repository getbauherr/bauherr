import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const src = join(__dirname, '../src')
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'migrations' ? [] : files(join(dir, e.name))) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []))

it('no payload.update/delete with `where` in src (find-then-update is not atomic): use cas() from lib/release.ts', () => {
  const hits = files(src).flatMap((f) => {
    const text = readFileSync(f, 'utf8')
    return [...text.matchAll(/\.(update|delete)\(\s*\{/g)].filter((m) => {
      let depth = 1
      let i = m.index! + m[0].length
      for (; i < text.length && depth > 0; i++) depth += text[i] === '{' ? 1 : text[i] === '}' ? -1 : 0
      return /\bwhere\s*:/.test(text.slice(m.index!, i))
    }).map((m) => `${f.slice(src.length + 1)}:${text.slice(0, m.index).split('\n').length}`)
  })
  expect(hits, 'use one conditional UPDATE ... RETURNING via cas()').toEqual([])
})
