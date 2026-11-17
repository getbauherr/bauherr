import { describe, expect, it } from 'vitest'
import type { Feature } from '../scripts/feature-map'
import { classify, pagesOf, parseArgs, resolveFeatures } from '../scripts/verify-resolve'

const feature = (over: Partial<Feature>): Feature => ({
  id: 'a', area: 'Workflow', title: 'A', summary: '', status: 'live', page: null, reach: '', mcp: [], source: [], tests: [], drive: null, proof: 'tests', gotchas: [], guards: [], debt: [],
  ...over,
})

const features = [
  feature({ id: 'one', source: ['apps/server/src/lib/one.ts'], tests: ['apps/server/tests/one.test.ts'], page: '/' }),
  feature({ id: 'two', area: 'Quality', source: ['apps/server/src/app/two'], tests: ['packages/runner/test/units.test.ts'], page: '/x/[id]' }),
]

describe('resolveFeatures', () => {
  it('matches an id exactly and an area case-insensitively', () => {
    expect(resolveFeatures(features, { kind: 'id', value: 'one' }).map((f) => f.id)).toEqual(['one'])
    expect(resolveFeatures(features, { kind: 'area', value: 'quality' }).map((f) => f.id)).toEqual(['two'])
    expect(resolveFeatures(features, { kind: 'id', value: 'nope' })).toEqual([])
  })

  it('maps changed source files, files under a source directory and changed tests to features', () => {
    const at = (files: string[]) => resolveFeatures(features, { kind: 'changed', files }).map((f) => f.id)
    expect(at(['apps/server/src/lib/one.ts'])).toEqual(['one'])
    expect(at(['apps/server/src/app/two/deep/file.tsx'])).toEqual(['two'])
    expect(at(['packages/runner/test/units.test.ts'])).toEqual(['two'])
    expect(at(['README.md'])).toEqual([])
    expect(at(['apps/server/src/lib/one.tsx'])).toEqual([])
  })
})

describe('classify', () => {
  it('splits vitest files, package tests, node:test files and Playwright specs', () => {
    expect(classify(['apps/server/tests/a.test.ts', 'packages/runner/test/u.test.ts', 'apps/server/tests/mcp.e2e.ts', 'apps/server/e2e/g.spec.ts'])).toEqual({
      vitest: ['apps/server/tests/a.test.ts'],
      packages: ['runner'],
      node: ['apps/server/tests/mcp.e2e.ts'],
      e2e: ['apps/server/e2e/g.spec.ts'],
    })
  })
})

describe('pagesOf', () => {
  it('skips features without a page and dynamic routes', () => {
    expect(pagesOf(features)).toEqual([{ id: 'one', page: '/' }])
  })
})

describe('parseArgs', () => {
  it('reads an id, --e2e, --out and --changed with an optional base', () => {
    expect(parseArgs(['inbox', '--e2e', '--out', '/p'])).toMatchObject({ selector: { kind: 'id', value: 'inbox' }, e2e: true, out: '/p' })
    expect(parseArgs(['--changed'])).toMatchObject({ selector: { kind: 'changed' }, base: 'origin/main' })
    expect(parseArgs(['--changed', 'develop'])).toMatchObject({ base: 'develop' })
    expect(parseArgs([]).selector).toBeNull()
  })
})
