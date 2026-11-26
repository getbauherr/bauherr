import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { releasePanel } from '../../src/core/releases/panel'
import { ReleaseRefused } from '../../src/core/releases/run'
import { releaseHarness } from './release-harness'

const { f, h, recording, setup, releaser, at, start, advance, states, expectNoWrite, deployed, commentsOn, NOW } =
  releaseHarness('core_release_run')

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
    await expect(start(releaser(), 'v0.6.0')).rejects.toThrow(/already used or is not a version/)
    await expect(start(releaser(), 'next')).rejects.toThrow(/already used or is not a version/)
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
