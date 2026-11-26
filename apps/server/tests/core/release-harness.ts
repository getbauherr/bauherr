import type { Backend, Forge } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { expect } from 'vitest'
import { refreshReadiness } from '../../src/core/readiness/refresh'
import { createReleaser } from '../../src/core/releases/run'
import { readerOf } from './mirror-harness'
import { flowHarness } from './modules-harness'

export const releaseHarness = (name: string) => {
  const f = flowHarness(name)
  const { h } = f

  const STAGING = 'on:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    environment: staging\n'
  const PRODUCTION = [
    'on:\n  workflow_dispatch:\n    inputs:\n      version:\n        required: true\n',
    'jobs:\n  deploy:\n    environment: production\n',
  ].join('')
  const NOW = new Date('2026-11-25T12:00:00Z')
  const LINK = 'https://bauherr/releases'

  type Seen = { forge: Forge; methods: Set<string> }

  const recording = (backend: Backend): { backend: Backend; seen: Seen } => {
    const methods = new Set<string>()
    const forge = new Proxy(backend.forge, {
      get: (target, name) => {
        const value: unknown = Reflect.get(target, name)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          methods.add(String(name))
          return Reflect.apply(value, target, args) as unknown
        }
      },
    })
    return { backend: { ...backend, forge, tickets: (repo) => backend.tickets(repo) }, seen: { forge, methods } }
  }

  const mergeTicket = async (
    repo: string,
    title: string,
    number: number,
    tag: string,
    bug = false,
    mergedAt = '2026-11-22T10:00:00Z',
  ) => {
    const fake = f.fake()
    const issue = (await fake.tickets(repo).create({ title })).number
    const found = await h.rows(sql`SELECT "id" FROM "ticket_sources" WHERE "repo" = ${repo}`)
    const source = z.object({ id: z.coerce.number() }).parse(found[0])
    const { workspace, product } = h.ids
    const item = (n: number, kind: string, state: string, closed: string | null) => h.rows(sql`
      INSERT INTO "mirror_items" ("workspace_id", "source_id", "product_id", "repo", "number", "kind", "title", "body",
        "state", "author", "author_trusted", "author_is_bot", "labels", "assignees", "url", "forge_created_at",
        "forge_updated_at", "forge_closed_at", "head_sha", "closes", "draft", "synced_at", "updated_at", "created_at")
      VALUES (${workspace}, ${source.id}, ${product}, ${repo}, ${n}, ${kind}, ${title}, '', ${state}, 'jo', true, false,
        '[]'::jsonb, '[]'::jsonb, 'https://forge/x', now(), now(), ${closed}::timestamptz, '', '[]'::jsonb, false,
        now(), now(), now())
      ON CONFLICT DO NOTHING`)
    const pr = 500 + number
    await item(issue, 'issue', 'closed', null)
    await item(pr, 'pr', 'merged', mergedAt)
    const changes = [{ text: `${title} works.`, tag }]
    const data = JSON.stringify({ type: bug ? 'bug' : 'change', result: { changes } })
    await h.rows(sql`
      INSERT INTO "records" ("workspace_id", "product_id", "source_forge", "source_repo", "source_number", "stage",
        "waiting_on", "rank", "version", "data", "pr", "updated_at", "created_at")
      VALUES (${workspace}, ${product}, 'github', ${repo}, ${issue}, 'ship', 'nobody', 0, 1, ${data}::jsonb, ${pr},
        now(), now())`)
    return issue
  }

  type Setup = { repo: string; staging: string; issues: number[] }

  const refresh = () =>
    refreshReadiness(
      h.payload(),
      { reader: async () => readerOf(f.fake()), now: () => NOW },
      { workspace: h.ids.workspace, product: h.ids.product },
    )

  const setup = async (o: { endpoint?: boolean; merged?: boolean } = {}): Promise<Setup> => {
    const s = await f.start('active')
    const fake = f.fake()
    await h.rows(sql`DELETE FROM "product_releases"`)
    await h.rows(sql`DELETE FROM "release_notes"`)
    const base = fake.commit(s.repo, 'main', 'base.txt', 'base')
    fake.setCommitDate(s.repo, base, '2026-11-19T10:00:00Z')
    fake.addRelease(s.repo, { tag: 'v0.6.0', sha: base, createdAt: '2026-11-19T10:00:00Z' })
    fake.commit(s.repo, 'main', '.github/workflows/staging.yml', STAGING)
    const staging = fake.commit(s.repo, 'main', '.github/workflows/production.yml', PRODUCTION)
    fake.setCommitDate(s.repo, staging, '2026-11-24T10:00:00Z')
    fake.setDeployment(s.repo, 'staging', { sha: staging, url: 'https://staging.example.com', state: 'success' })
    fake.setDeployment(s.repo, 'production', { sha: base, url: 'https://example.com', state: 'success' })
    fake.setCommitEndpoint(s.repo, o.endpoint ?? true)
    const issues = o.merged === false ? [] : [await mergeTicket(s.repo, 'Memory as documents', 1, 'visible')]
    if (o.merged !== false) issues.push(await mergeTicket(s.repo, 'Sign-in works again', 2, 'visible', true))
    await refresh()
    return { repo: s.repo, staging, issues }
  }

  const releaser = (backend: Backend = f.fake()) =>
    createReleaser(h.payload(), { backend: async () => backend, now: () => NOW })
  const at = () => ({ workspace: h.ids.workspace, product: h.ids.product })
  type Releaser = ReturnType<typeof releaser>

  const present = <T>(value: T | null): T => {
    if (value === null) throw new Error('a run was expected')
    return value
  }
  const ask = () => Promise.resolve('not json')
  const start = async (r: Releaser, version = 'v0.7.0') =>
    present(await r.start({ ...at(), version, notesLink: LINK }, ask))
  const advance = async (r: Releaser, id: number) => present(await r.advance(id))
  type Stepped = { steps: { id: string; status: string }[] }
  const states = (run: Stepped) => run.steps.map((step) => `${step.id}:${step.status}`)

  const expectNoWrite = (repo: string) => {
    const fake = f.fake()
    expect(fake.listReleases(repo).filter((rel) => rel.tag === 'v0.7.0')).toEqual([])
    expect(fake.deployStarts(repo)).toEqual([])
    return fake.forge.listTags(repo).then((tags) => expect(tags).not.toContain('v0.7.0'))
  }

  const deployed = (s: Setup, state: 'success' | 'failure' | 'pending' = 'success') =>
    f.fake().setDeployment(s.repo, 'production', { sha: s.staging, url: 'https://example.com', state })

  const commentsOn = async (repo: string, issue: number) =>
    (await f.fake().tickets(repo).listComments(String(issue))).filter((c) => c.body.includes('Released in v0.7.0'))

  return {
    f, h, recording, mergeTicket, refresh, setup, releaser, at, start, advance, states, expectNoWrite, deployed,
    commentsOn, ask, NOW,
  }
}
