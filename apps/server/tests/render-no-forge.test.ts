import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'

const src = join(__dirname, '../src')
const app = join(src, 'app/(app)')
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))

/** Render path: pages, layouts and the loaders they call. A render reads only the database; forge calls belong to a job, a server action or a component streamed through <Suspense>. */
const rendered = [
  ...walk(app).filter((f) => /\/(page|layout)\.tsx$/.test(f)),
  ...['overview', 'settings', 'run', 'requests', 'setup'].map((n) => join(app, `lib/${n}.ts`)),
]

const FORBIDDEN = /(?<!function )\b(ticketsOf|forgeOf|sourceOf|backendFor|prOf|recentChecks|releaseDraft|deadTickets|invisibleDead|suggestOverlapIgnore|listRepos)\(|\.(listComments|listPullRequestFiles|listPullRequests|listChecks|listReleases|listRepositories)\(/g

/** file (relative to src) -> identifiers allowed there, each with the reason it is not on the blocking render path. */
const ALLOWED: Record<string, { ids: string[]; why: string }> = {
  'app/(app)/(shell)/tickets/[id]/page.tsx': { ids: ['sourceOf', 'prOf', '.listComments', '.listChecks'], why: 'only inside derive(), awaited by components under <Suspense> with a 5 s within()' },
  'app/(app)/(shell)/requests/[id]/page.tsx': { ids: ['sourceOf', '.listComments'], why: 'only inside Comments(), under <Suspense> with a 5 s within()' },
  'app/(app)/lib/settings.ts': { ids: ['forgeOf', 'backendFor', '.listChecks', '.listRepositories'], why: 'recentChecks/collectChecks run in DeploySectionsStreamed (<Suspense>, 3 s); listRepos is called by a server action and the open exception below' },
  'app/(app)/(shell)/releases/page.tsx': { ids: ['releaseDraft'], why: 'only inside Draft(), under <Suspense> with an 8 s within()' },
  'app/(app)/(shell)/settings/workspace/page.tsx': { ids: ['listRepos'], why: 'KNOWN OPEN: the knowledge repo picker still waits up to 3 s for the forge; to be streamed' },
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
