import type { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it, vi } from 'vitest'
import { RELEASE_CHECK_IDS } from '../../src/core/readiness/release-checks'
import { highestVersion } from '../../src/core/readiness/release-facts'
import { refreshReadiness } from '../../src/core/readiness/refresh'
import { readiness, releaseBlockedOf } from '../../src/core/readiness/view'
import { readerOf } from './mirror-harness'
import { flowHarness } from './modules-harness'

const f = flowHarness('core_readiness_release')
const { h } = f

const STAGING = 'jobs:\n  deploy:\n    environment: staging\n'
const NOTHING = 'jobs:\n  build:\n    runs-on: ubuntu-latest\n'
const PRODUCTION = (inputs: string) =>
  `on:\n  workflow_dispatch:\n${inputs}jobs:\n  deploy:\n    environment: production\n`
const WITH_VERSION = PRODUCTION('    inputs:\n      version:\n        required: true\n')
const WITHOUT_INPUT = PRODUCTION('')

type Piece = 'staging-deploy' | 'staging-address' | 'version-input' | 'commit-endpoint' | 'last-version' | 'rights'

const furnish = (fake: FakeBackend, repo: string, without: Piece[] = []) => {
  const lacks = (piece: Piece) => without.includes(piece)
  const sha = fake.commit(repo, 'main', '.github/workflows/staging.yml', lacks('staging-deploy') ? NOTHING : STAGING)
  fake.commit(repo, 'main', '.github/workflows/production.yml', lacks('version-input') ? WITHOUT_INPUT : WITH_VERSION)
  fake.setDeployment(repo, 'staging', { sha, url: lacks('staging-address') ? null : 'https://staging.example.com' })
  fake.setCommitEndpoint(repo, !lacks('commit-endpoint'))
  fake.setCanWrite(repo, !lacks('rights'))
  if (!lacks('last-version')) fake.addTag(repo, 'v0.6.0', sha)
}

const filter = () => ({ workspace: h.ids.workspace, product: h.ids.product, now: new Date() })

const started = async (without: Piece[] = []) => {
  const s = await f.start('active')
  furnish(f.fake(), s.repo, without)
  await refreshReadiness(
    h.payload(),
    { reader: async () => readerOf(f.fake()), now: () => new Date() },
    { workspace: h.ids.workspace, product: h.ids.product },
  )
  return s
}

const releaseItems = async () => {
  const view = await readiness(h.payload(), filter())
  return { view, items: view?.items.filter((item) => RELEASE_CHECK_IDS.some((id) => id === item.id)) ?? [] }
}

describe('release checks', () => {
  it('shows all seven checks ready on a repository that has every piece, and offers Release', async () => {
    await started()
    const { view, items } = await releaseItems()
    expect(items.map((item) => [item.id, item.status])).toEqual(RELEASE_CHECK_IDS.map((id) => [id, 'ready']))
    expect(view?.release).toEqual({ mode: 'factory', blocked: false, offered: true })
    expect(await releaseBlockedOf(h.payload(), filter())).toBe(false)
  })

  const CASES: [Piece, string][] = [
    ['staging-deploy', 'release-staging-deploy'],
    ['staging-address', 'release-staging-address'],
    ['version-input', 'release-version-input'],
    ['commit-endpoint', 'release-commit-endpoint'],
    ['last-version', 'release-last-version'],
    ['rights', 'release-rights'],
  ]

  it.each(CASES)('turns only the check of a missing %s into a gap that blocks Release', async (piece, check) => {
    await started([piece])
    const { view, items } = await releaseItems()
    const gaps = items.filter((item) => item.status === 'gap')
    expect(gaps.map((item) => item.id)).toEqual([check])
    expect(gaps[0]?.fix).toMatchObject({ kind: 'ticket', label: 'Make it a ticket' })
    expect(view?.release).toEqual({ mode: 'factory', blocked: true, offered: false })
    expect(await releaseBlockedOf(h.payload(), filter())).toBe(true)
  })

  it('takes the highest semantic version among tags and releases, even for a tag without a release', async () => {
    const s = await f.start('active')
    furnish(f.fake(), s.repo, ['last-version'])
    f.fake().addTag(s.repo, 'v0.3.0')
    f.fake().addRelease(s.repo, { tag: 'v0.2.1', sha: 'sha1' })
    await refreshReadiness(
      h.payload(),
      { reader: async () => readerOf(f.fake()), now: () => new Date() },
      { workspace: h.ids.workspace, product: h.ids.product },
    )
    const found = (await releaseItems()).items.find((item) => item.id === 'release-last-version')
    expect(found).toMatchObject({ status: 'ready', detail: 'v0.3.0 (tags and releases).' })
  })

  it('ranks a pre-release below its final version and ignores names that are no version', () => {
    expect(highestVersion(['v0.3.0-rc.1', 'v0.3.0', 'v0.2.9', 'latest'])).toBe('v0.3.0')
    expect(highestVersion(['v0.10.0', 'v0.9.0'])).toBe('v0.10.0')
    expect(highestVersion(['latest'])).toBeNull()
  })

  it('reads no forge when rendering: only the daily check stores the facts', async () => {
    const s = await started()
    const { forge } = f.fake()
    const names = ['listFiles', 'listTags', 'listReleases', 'latestDeployment', 'commitEndpoint', 'canWrite'] as const
    const reads = names.map((name) => vi.spyOn(forge, name).mockRejectedValue(new Error('forge must not be read')))
    const { items } = await releaseItems()
    expect(items.every((item) => item.status === 'ready')).toBe(true)
    expect(reads.map((read) => read.mock.calls.length)).toEqual([0, 0, 0, 0, 0, 0])
    const stored = await h.rows(sql`SELECT "release_facts" AS facts FROM "ticket_sources" WHERE "repo" = ${s.repo}`)
    const facts = { stagingWorkflow: '.github/workflows/staging.yml', lastVersion: 'v0.6.0' }
    expect(stored[0]).toMatchObject({ facts })
    vi.restoreAllMocks()
  })

  it('shows every check as unknown, and blocks Release, before the facts are read', async () => {
    await f.start('active')
    const { view, items } = await releaseItems()
    expect(items.map((item) => item.status)).toEqual(RELEASE_CHECK_IDS.map(() => 'unknown'))
    expect(view?.release.blocked).toBe(true)
  })

  it('shows no release gaps and offers no Release for a product whose merges go straight to production', async () => {
    await started(['staging-deploy', 'rights'])
    await h.rows(sql`UPDATE "products" SET "release_mode" = 'direct' WHERE "id" = ${h.ids.product}`)
    const { view, items } = await releaseItems()
    expect(items).toEqual([])
    expect(view?.release).toEqual({ mode: 'direct', blocked: false, offered: false })
    await h.rows(sql`UPDATE "products" SET "release_mode" = NULL WHERE "id" = ${h.ids.product}`)
    expect((await readiness(h.payload(), filter()))?.release.mode).toBe('factory')
  })
})
