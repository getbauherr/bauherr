import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'

const src = join(__dirname, '../src')
const app = join(src, 'app/(app)')
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))

const rendered = [
  ...walk(app).filter((f) => /\/(page|layout)\.tsx$/.test(f)),
  join(app, 'lib/settings.ts'),
]

const FORBIDDEN = /(?<!function )\b(ticketsOf|forgeOf|sourceOf|backendFor|prOf|recentChecks|releaseDraft|deadTickets|invisibleDead|suggestOverlapIgnore|listRepos|decisionComments)\(|\.(listComments|listPullRequestFiles|listPullRequests|listChecks|listReleases|listRepositories)\(/g

const ALLOWED: Record<string, { ids: string[]; why: string }> = {
  'app/(app)/lib/settings.ts': { ids: ['backendFor', '.listRepositories'], why: 'listRepos is called by a server action' },
}

it('no page, layout or render loader calls a forge client outside the documented allow-list', () => {
  const hits = rendered.flatMap((f) => {
    const key = relative(src, f)
    const allowed = ALLOWED[key]?.ids ?? []
    return [...readFileSync(f, 'utf8').matchAll(FORBIDDEN)]
      .map((m) => m[0].replace(/\($/, ''))
      .filter((id) => !allowed.includes(id))
      .map((id) => `${key}: ${id}`)
  })
  expect(hits, 'a render reads only the database: move the call to a job, a server action or a <Suspense> component, or allow it in ALLOWED with the reason').toEqual([])
})

it('every allow-list entry still matches something (no stale exceptions)', () => {
  for (const [key, { ids }] of Object.entries(ALLOWED)) {
    const found = new Set([...readFileSync(join(src, key), 'utf8').matchAll(FORBIDDEN)].map((m) => m[0].replace(/\($/, '')))
    expect(ids.filter((id) => !found.has(id)), key).toEqual([])
  }
})
