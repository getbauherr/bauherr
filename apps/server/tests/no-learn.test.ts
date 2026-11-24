import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseEvent } from '../src/core/events'

const SERVER_SRC = join(__dirname, '..', 'src')
const PACK = join(__dirname, '..', '..', '..', 'pack')

const paths = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? paths(join(dir, entry.name)) : [join(dir, entry.name)],
  )

const named = (dir: string) =>
  paths(dir).filter((path) => !path.includes('/migrations/') && /learn/i.test(path.slice(dir.length)))

describe('the Learn step is gone', () => {
  it('has no file or folder named learn under apps/server/src or pack', () => {
    expect([...named(SERVER_SRC), ...named(PACK)]).toEqual([])
  })

  it('has no event type named learn', () => {
    for (const type of ['learn.submitted', 'learn.skipped']) {
      expect(() => parseEvent({ type, data: {} })).toThrow()
    }
    const source = paths(join(SERVER_SRC, 'core')).filter((path) => path.endsWith('events.ts'))
    expect(source.map((path) => readFileSync(path, 'utf8')).join('')).not.toMatch(/learn/i)
  })

  it('has no skill named learn in the pack', () => {
    expect(readFileSync(join(PACK, 'pack.yaml'), 'utf8')).not.toMatch(/learn/i)
  })
})
