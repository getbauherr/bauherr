import type { Backend, Forge } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { refreshReadiness } from '../../src/core/readiness/refresh'
import { releasePanel } from '../../src/core/releases/panel'
import { createReleaser, ReleaseRefused } from '../../src/core/releases/run'
import { readerOf } from './mirror-harness'
import { flowHarness } from './modules-harness'

const f = flowHarness('core_release_run')
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

const mergeTicket = async (repo: string, title: string, number: number, tag: string, bug = false) => {
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
  await item(pr, 'pr', 'merged', '2026-11-22T10:00:00Z')
  const data = JSON.stringify({ type: bug ? 'bug' : 'change', result: { changes: [{ text: `${title} works.`, tag }] } })
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
const start = async (r: Releaser, version = 'v0.7.0') => present(await r.start({ ...at(), version, notesLink: LINK }))
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

describe('release run', () => {
  it('proposes the next version from the merged tickets and refuses nothing when all is ready', async () => {
    await setup()
    const panel = await releasePanel(h.payload(), at(), NOW)
    expect(panel?.proposal).toEqual({ version: 'v0.7.0', bump: 'minor' })
    expect(panel?.refusal).toBeNull()
    expect(panel?.run).toBeNull()
  })

  it('runs tag and draft, deploy, check, publish and mark in order, once', async () => {
    const s = await setup()
    const fake = f.fake()
    const r = releaser()
    const first = await start(r)
    expect(states(first)).toEqual([
      'tag:done', 'deploy:done', 'wait:todo', 'check:todo', 'publish:todo', 'tell:todo',
    ])
    expect(await fake.forge.releaseByTag(s.repo, 'v0.7.0')).toBeNull()
    expect(fake.listReleases(s.repo).find((rel) => rel.tag === 'v0.7.0')?.draft).toBe(true)
    expect(fake.deployStarts(s.repo)).toEqual([
      { workflow: '.github/workflows/production.yml', ref: 'v0.7.0', inputs: { version: 'v0.7.0' } },
    ])
    expect(first.steps[0]?.link).toContain('v0.7.0')
    deployed(s)
    const done = await advance(r, first.id)
    expect(done.state).toBe('done')
    expect(done.steps.every((step) => step.status === 'done')).toBe(true)
    const published = await fake.forge.releaseByTag(s.repo, 'v0.7.0')
    expect(published?.sha).toBe(s.staging)
    expect(published?.body).toContain('Read the full release notes in Bauherr')
    for (const issue of s.issues) expect(await commentsOn(s.repo, issue)).toHaveLength(1)
  })

  it('creates no second tag, release, deploy or comment when run again after any step', async () => {
    const s = await setup()
    const fake = f.fake()
    const r = releaser()
    const first = await start(r)
    await start(r)
    await advance(r, first.id)
    deployed(s)
    await advance(r, first.id)
    await start(r)
    await advance(r, first.id)
    expect(fake.listReleases(s.repo).filter((rel) => rel.tag === 'v0.7.0')).toHaveLength(1)
    expect(fake.deployStarts(s.repo)).toHaveLength(1)
    for (const issue of s.issues) expect(await commentsOn(s.repo, issue)).toHaveLength(1)
    const rows = await h.rows(sql`SELECT count(*) AS n FROM "product_releases"`)
    expect(Number(rows[0]?.n)).toBe(1)
  })

  it('starts no second deploy when the first one is already visible on the forge', async () => {
    const s = await setup()
    const fake = f.fake()
    deployed(s, 'pending')
    await start(releaser())
    expect(fake.deployStarts(s.repo)).toHaveLength(0)
  })

  it('stops at a failing production deploy, keeps the draft a draft and asks what to do', async () => {
    const s = await setup()
    const fake = f.fake()
    const r = releaser()
    const first = await start(r)
    deployed(s, 'failure')
    const failed = await advance(r, first.id)
    expect(failed.state).toBe('failed')
    expect(states(failed)).toEqual([
      'tag:done', 'deploy:done', 'wait:failed', 'check:todo', 'publish:todo', 'tell:todo',
    ])
    expect(await fake.forge.releaseByTag(s.repo, 'v0.7.0')).toBeNull()
    const panel = await releasePanel(h.payload(), at(), NOW)
    expect(panel?.run?.question?.options).toEqual(['check-again', 'release-fixed-later'])
    expect(panel?.refusal).toContain('not finished')
    deployed(s)
    await r.answer(at(), first.id, 'check-again')
    expect((await fake.forge.releaseByTag(s.repo, 'v0.7.0'))?.draft).toBeUndefined()
    expect(fake.deployStarts(s.repo)).toHaveLength(1)
  })

  it('fails the check step when production shows no commit, and gives up for a fixed version later', async () => {
    const s = await setup({ endpoint: false })
    const fake = f.fake()
    const facts = sql`jsonb_set("release_facts", '{commitEndpoint}', 'true')`
    await h.rows(sql`UPDATE "ticket_sources" SET "release_facts" = ${facts}`)
    const r = releaser()
    const first = await start(r)
    deployed(s)
    const stopped = await advance(r, first.id)
    expect(stopped.steps.find((step) => step.status === 'failed')?.id).toBe('check')
    expect(await fake.forge.releaseByTag(s.repo, 'v0.7.0')).toBeNull()
    await r.answer(at(), first.id, 'release-fixed-later')
    const panel = await releasePanel(h.payload(), at(), NOW)
    expect(panel?.run).toBeNull()
    expect(fake.listReleases(s.repo).find((rel) => rel.tag === 'v0.7.0')?.draft).toBe(true)
  })

  it('refuses while the product has release gaps', async () => {
    const s = await setup({ endpoint: false })
    await expect(start(releaser())).rejects.toThrow(/release gaps/)
    await expectNoWrite(s.repo)
    expect((await releasePanel(h.payload(), at(), NOW))?.refusal).toMatch(/release gaps/)
  })

  it('refuses when nothing was merged since the last version', async () => {
    const s = await setup({ merged: false })
    await expect(start(releaser())).rejects.toBeInstanceOf(ReleaseRefused)
    await expect(start(releaser())).rejects.toThrow(/Nothing was merged/)
    await expectNoWrite(s.repo)
  })

  it('refuses a version number that exists or is not a version', async () => {
    await setup()
    await expect(start(releaser(), 'v0.6.0')).rejects.toThrow(/not a new version/)
    await expect(start(releaser(), 'next')).rejects.toThrow(/not a new version/)
  })

  it('only tags, drafts, starts the production workflow, publishes and reads: it never builds or deploys', async () => {
    const s = await setup()
    const { backend, seen } = recording(f.fake())
    const r = releaser(backend)
    const first = await start(r)
    deployed(s)
    await advance(r, first.id)
    const writes = ['draftRelease', 'startDeploy', 'publishRelease']
    const reads = ['latestDeployment', 'commitEndpoint', 'getRepository', 'listReleases', 'listTags', 'releaseByTag']
    const allowed = [...writes, ...reads, 'tagSha', 'getCommitDate', 'listChecks', 'getFile', 'listFiles', 'canWrite']
    const forbidden = [...seen.methods].filter((name) => !allowed.includes(name))
    expect(forbidden).toEqual([])
    expect(seen.methods.has('startDeploy')).toBe(true)
  })

  it('starts the production deploy once per version even when the deploy step failed after it started', async () => {
    const s = await setup()
    const fake = f.fake()
    let failures = 1
    const forge = new Proxy(fake.forge, {
      get: (target, name) => {
        const value: unknown = Reflect.get(target, name)
        if (name !== 'getRepository' || typeof value !== 'function') return value
        return (...args: unknown[]) => {
          if (failures-- > 0) return Promise.reject(new Error('forge unavailable'))
          return Reflect.apply(value, target, args) as unknown
        }
      },
    })
    const r = releaser({ ...fake, forge, tickets: (repo) => fake.tickets(repo) })
    const first = await start(r)
    expect(first.steps.find((step) => step.status === 'failed')?.id).toBe('deploy')
    expect(fake.deployStarts(s.repo)).toHaveLength(1)
    await r.answer(at(), first.id, 'check-again')
    expect(fake.deployStarts(s.repo)).toHaveLength(1)
  })

  it('does not let another workspace or product answer a stopped release', async () => {
    const s = await setup()
    const r = releaser()
    const first = await start(r)
    deployed(s, 'failure')
    await advance(r, first.id)
    await r.answer({ workspace: h.ids.workspace + 999, product: h.ids.product }, first.id, 'release-fixed-later')
    await r.answer({ workspace: h.ids.workspace, product: h.ids.product + 999 }, first.id, 'release-fixed-later')
    expect((await advance(r, first.id)).state).toBe('failed')
    await r.answer(at(), first.id, 'release-fixed-later')
    const rows = await h.rows(sql`SELECT "state" FROM "product_releases" WHERE "id" = ${first.id}`)
    expect(rows[0]?.state).toBe('abandoned')
  })

  it('counts a finished release as the last version at once', async () => {
    const s = await setup()
    const r = releaser()
    const first = await start(r)
    deployed(s)
    expect((await advance(r, first.id)).state).toBe('done')
    const panel = await releasePanel(h.payload(), at(), NOW)
    expect(panel?.refusal).toMatch(/Nothing was merged/)
    expect(panel?.proposal.version).toBe('v0.7.1')
    await expect(start(r, 'v0.7.1')).rejects.toThrow(/Nothing was merged/)
  })
})
