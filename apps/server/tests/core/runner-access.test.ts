import { generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { gitAccess } from '../../src/jobs/runner/deps'
import type { ConnectionInput } from '../../src/lib/connection'
import { startGitHttp, type GitHttp } from './git-http'
import { runnerHarness } from './runner-harness'

const r = runnerHarness('core_runner_access')
let http: GitHttp

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString()

const exchange = () => {
  let issued = 0
  const fetcher = (async (input: string) => {
    if (!input.endsWith('/access_tokens')) return new Response('not found', { status: 404 })
    const expires_at = new Date(Date.now() + 60_000).toISOString()
    return Response.json({ token: `ghs_installation_${++issued}`, expires_at }, { status: 201 })
  }) as typeof fetch
  return fetcher
}

let nextId = 900
const connection = (kind: 'github' | 'gitlab', config: Record<string, unknown>, secret: string): ConnectionInput => ({
  id: ++nextId,
  kind,
  config,
  secret,
  capabilities: {},
})
const app = () => connection('github', { appId: '12', installationId: '34' }, pem)

const credentials = (path: string) => http.seen.filter((s) => s.path.includes(path)).map((s) => s.credential)

beforeAll(async () => {
  http = await startGitHttp(r.remote.bare)
  process.env.BAUHERR_GIT_BASE_URL = http.url
})

afterAll(async () => {
  delete process.env.BAUHERR_GIT_BASE_URL
  await http.close()
})

beforeEach(() => {
  http.seen.length = 0
  http.refuse.receive = false
})

const build = async (access: ReturnType<typeof gitAccess>) => {
  r.state.access = access
  await r.toBuild()
  http.seen.length = 0
  return r.next()
}

describe('a Build run on a repository behind a GitHub App', () => {
  it('clones and uploads with an installation token, a fresh one for the upload', async () => {
    expect(await build(gitAccess(app(), 'o/n', 'main', { fetch: exchange() }))).toBe('accepted')
    const clone = credentials('git-upload-pack').filter((c) => c !== null)
    const upload = credentials('git-receive-pack').filter((c) => c !== null)
    expect(clone.length).toBeGreaterThan(0)
    expect(upload.length).toBeGreaterThan(0)
    expect(clone.every((c) => /^x-access-token:ghs_installation_\d+$/.test(c))).toBe(true)
    expect(upload.every((c) => /^x-access-token:ghs_installation_\d+$/.test(c))).toBe(true)
    expect(new Set(upload).size).toBe(1)
    expect(upload[0]).not.toBe(clone[0])
    expect(r.remote.files(`bauherr/1-${String((await r.runRow('build'))?.id)}`)).toContain('change.txt')
  })

  it('puts the token in no stored error when the upload is refused', async () => {
    r.state.access = gitAccess(app(), 'o/n', 'main', { fetch: exchange() })
    await r.toBuild()
    http.refuse.receive = true
    expect(await r.next()).toBe('failed')
    const tokens = http.seen.flatMap((s) => (s.credential ? [s.credential.split(':')[1] ?? ''] : []))
    expect(tokens.length).toBeGreaterThan(0)
    const run = await r.runRow('build')
    expect(String(run?.error)).toMatch(/receive-pack|403|git/)
    for (const token of tokens) expect(JSON.stringify(run)).not.toContain(token)
    const types = await r.f.types(r.state.record)
    expect(types).toContain('run.failed')
  })
})

describe('the other connections', () => {
  it('keeps working with a personal access token', async () => {
    const access = gitAccess(connection('github', {}, 'ghp_personal'), 'o/n', 'main')
    expect(await build(access)).toBe('accepted')
    const all = http.seen.map((s) => s.credential).filter((c) => c !== null)
    expect(new Set(all)).toEqual(new Set(['x-access-token:ghp_personal']))
  })

  it('keeps working with GitLab, as oauth2', async () => {
    const access = gitAccess(connection('gitlab', { baseUrl: 'https://gitlab.com' }, 'glpat'), 'o/n', 'main')
    expect(await build(access)).toBe('accepted')
    const all = http.seen.map((s) => s.credential).filter((c) => c !== null)
    expect(new Set(all)).toEqual(new Set(['oauth2:glpat']))
  })
})
