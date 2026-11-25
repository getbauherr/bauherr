import type { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { refreshReadiness } from '../../src/core/readiness/refresh'
import { releasesPage } from '../../src/core/releases/view'
import { readerOf } from './mirror-harness'
import { flowHarness } from './modules-harness'

const f = flowHarness('core_releases_page')
const { h } = f

type Ticket = { number: number; title: string; mergedAt: string; visible: boolean; accepted: boolean }

const refresh = () =>
  refreshReadiness(
    h.payload(),
    { reader: async () => readerOf(f.fake()), now: () => new Date() },
    { workspace: h.ids.workspace, product: h.ids.product },
  )

const release = (fake: FakeBackend, repo: string, tag: string, at: string, body: string) => {
  const sha = fake.commit(repo, 'main', `${tag}.txt`, tag)
  fake.setCommitDate(repo, sha, at)
  fake.addRelease(repo, { tag, sha, body, createdAt: at })
  return sha
}

const mergedTicket = async (repo: string, t: Ticket) => {
  const found = await h.rows(sql`SELECT "id" FROM "ticket_sources" WHERE "repo" = ${repo}`)
  const source = z.object({ id: z.coerce.number() }).parse(found[0])
  const { workspace, product } = h.ids
  const issue = 10 + t.number
  const number = 100 + t.number
  const item = (n: number, kind: string, title: string, state: string, closed: string | null) => h.rows(sql`
    INSERT INTO "mirror_items" ("workspace_id", "source_id", "product_id", "repo", "number", "kind", "title", "body",
      "state", "author", "author_trusted", "author_is_bot", "labels", "assignees", "url", "forge_created_at",
      "forge_updated_at", "forge_closed_at", "head_sha", "closes", "draft", "synced_at", "updated_at", "created_at")
    VALUES (${workspace}, ${source.id}, ${product}, ${repo}, ${n}, ${kind}, ${title}, '', ${state}, 'jo', true, false,
      '[]'::jsonb, '[]'::jsonb, 'https://forge/x', now(), now(), ${closed}::timestamptz, '', '[]'::jsonb, false,
      now(), now(), now())`)
  await item(issue, 'issue', t.title, 'closed', null)
  await item(number, 'pr', `pr ${t.title}`, 'merged', t.mergedAt)
  const changes = [{ text: 'A change', tag: t.visible ? 'visible' : 'internal' }]
  const data = JSON.stringify({ result: { changes } })
  const record = await h.rows(sql`
    INSERT INTO "records" ("workspace_id", "product_id", "source_forge", "source_repo", "source_number", "stage",
      "waiting_on", "rank", "version", "data", "pr", "updated_at", "created_at")
    VALUES (${workspace}, ${product}, 'github', ${repo}, ${issue}, 'ship', 'nobody', 0, 1, ${data}::jsonb,
      ${number}, now(), now()) RETURNING "id"`)
  if (t.accepted) {
    await h.rows(sql`
      INSERT INTO "events" ("workspace_id", "record_id", "type", "actor", "data", "updated_at", "created_at")
      VALUES (${workspace}, ${z.coerce.number().parse(record[0]?.id)}, 'result.accepted', 'owner', '{}'::jsonb, now(),
        '2026-11-20T10:00:00Z')`)
  }
}

const merged = (repo: string, number: number, title: string, mergedAt: string, visible: boolean, accepted: boolean) =>
  mergedTicket(repo, { number, title, mergedAt, visible, accepted })

const page = () => releasesPage(h.payload(), { workspace: h.ids.workspace, product: h.ids.product })

describe('releases page', () => {
  it('shows production, staging, the count of changes and past versions from stored facts', async () => {
    const s = await f.start('active')
    const fake = f.fake()
    release(fake, s.repo, 'v0.4.0', '2026-11-05T10:00:00Z', '')
    release(fake, s.repo, 'v0.5.0', '2026-11-10T10:00:00Z', 'Notes of five')
    const production = release(fake, s.repo, 'v0.6.0', '2026-11-19T10:00:00Z', 'Notes of six')
    fake.setDeployment(s.repo, 'production', { sha: production, url: null, state: 'success' })
    const staging = fake.commit(s.repo, 'main', 'next.txt', 'next')
    fake.setDeployment(s.repo, 'staging', { sha: staging, url: 'https://staging.example.com', state: 'success' })
    fake.setChecks(s.repo, staging, [{ name: 'ci', status: 'completed', conclusion: 'success' }])
    await merged(s.repo, 1, 'Early', '2026-11-07T10:00:00Z', true, true)
    await merged(s.repo, 2, 'Middle', '2026-11-12T10:00:00Z', false, true)
    await merged(s.repo, 3, 'Newest', '2026-11-21T10:00:00Z', true, true)
    await merged(s.repo, 4, 'Newer', '2026-11-22T10:00:00Z', false, true)
    await refresh()
    const throwing = () => Promise.reject(new Error('the page must not call the forge'))
    fake.forge.listTags = throwing
    fake.forge.listReleases = throwing
    fake.forge.latestDeployment = throwing
    const view = await page()
    expect(view.production).toMatchObject({ tag: 'v0.6.0', at: '2026-11-19T10:00:00.000Z' })
    expect(view.staging).toEqual({ sha: staging, checks: 'passing' })
    expect(view.ready?.since).toBe('v0.6.0')
    expect(view.ready?.tickets.map((t) => t.title)).toEqual(['Newer', 'Newest'])
    expect(view.ready?.visible).toBe(1)
    expect(view.past.map((v) => [v.tag, v.changes, v.notes !== null, v.url !== null])).toEqual([
      ['v0.6.0', 1, true, true],
      ['v0.5.0', 1, true, true],
      ['v0.4.0', 0, false, true],
    ])
  })

  it('lists only changes merged after a tag that has no release, and marks the ones not accepted yet', async () => {
    const s = await f.start('active')
    const fake = f.fake()
    const sha = fake.commit(s.repo, 'main', 'tagged.txt', 'tagged')
    fake.setCommitDate(s.repo, sha, '2026-11-10T10:00:00Z')
    fake.addTag(s.repo, 'v0.3.0', sha)
    await merged(s.repo, 1, 'Before', '2026-11-05T10:00:00Z', true, true)
    await merged(s.repo, 2, 'After accepted', '2026-11-12T10:00:00Z', true, true)
    await merged(s.repo, 3, 'After waiting', '2026-11-15T10:00:00Z', false, false)
    await refresh()
    const view = await page()
    expect(view.ready?.since).toBe('v0.3.0')
    expect(view.ready?.tickets.map((t) => [t.title, t.acceptedAt !== null])).toEqual([
      ['After waiting', false],
      ['After accepted', true],
    ])
    expect(view.ready?.visible).toBe(1)
    expect(view.past).toEqual([{ tag: 'v0.3.0', at: '2026-11-10T10:00:00.000Z', changes: 1, notes: null, url: null }])
  })

  it('picks the highest version when the forge has more than twenty tags', async () => {
    const s = await f.start('active')
    const fake = f.fake()
    for (let n = 1; n <= 25; n++) {
      release(fake, s.repo, `v0.${n}.0`, new Date(Date.UTC(2026, 9, n, 10)).toISOString(), '')
    }
    await merged(s.repo, 1, 'Already released', '2026-10-24T12:00:00Z', true, true)
    await merged(s.repo, 2, 'Not released yet', '2026-11-20T12:00:00Z', true, true)
    await refresh()
    const view = await page()
    expect(view.ready?.since).toBe('v0.25.0')
    expect(view.ready?.tickets.map((t) => t.title)).toEqual(['Not released yet'])
    expect(view.past[0]?.tag).toBe('v0.25.0')
  })

  it('counts the oldest listed version from the next older version, not from the beginning', async () => {
    const s = await f.start('active')
    const fake = f.fake()
    for (let n = 1; n <= 25; n++) {
      release(fake, s.repo, `v0.${n}.0`, new Date(Date.UTC(2026, 9, n, 10)).toISOString(), '')
    }
    await merged(s.repo, 1, 'Two', '2026-10-02T12:00:00Z', true, true)
    await merged(s.repo, 2, 'Three', '2026-10-03T12:00:00Z', true, true)
    await merged(s.repo, 3, 'Five', '2026-10-05T12:00:00Z', true, true)
    await refresh()
    const view = await page()
    expect(view.past).toHaveLength(20)
    expect(view.past.at(-1)).toMatchObject({ tag: 'v0.6.0', changes: 1 })
  })
})
