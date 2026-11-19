import { generateKeyPairSync } from 'node:crypto'
import { expect, it } from 'vitest'
import { backendFor, verifyForge } from '../src/lib/adapters'
import { forgeConfig, type ConnectionInput } from '../src/lib/connection'
import type { Payload } from 'payload'

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

const forge = (repositories: unknown[], expiresInMs = 3_600_000) => {
  const calls: { url: string; auth: string | null }[] = []
  const fetcher = (async (input: string, init?: RequestInit) => {
    const url = input
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') })
    if (url.endsWith('/access_tokens')) {
      const expires_at = new Date(Date.now() + expiresInMs).toISOString()
      return Response.json({ token: `ghs_${calls.length}`, expires_at }, { status: 201 })
    }
    if (url.includes('/installation/repositories')) return Response.json({ repositories })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  return { calls, fetcher }
}

const app = (id: number, secret: string | null = pem): ConnectionInput => ({
  id, kind: 'github', config: { appId: '12', installationId: '34' }, secret, capabilities: {},
})
const repo = { full_name: 'acme/shop', default_branch: 'main', private: true, html_url: 'https://github.com/acme/shop' }
const tokenCalls = (calls: { url: string }[]) => calls.filter((c) => c.url.endsWith('/access_tokens')).length

it('verifies an App connection through an installation token that can read a repository', async () => {
  const { calls, fetcher } = forge([repo])
  await verifyForge(app(101), { fetch: fetcher })
  expect(calls.map((c) => c.url)).toEqual([
    'https://api.github.com/app/installations/34/access_tokens',
    'https://api.github.com/installation/repositories?per_page=100',
  ])
  expect(calls[1]?.auth).toBe('Bearer ghs_1')
})

it('fails verification in plain words when the installation reads no repository', async () => {
  await expect(verifyForge(app(102), { fetch: forge([]).fetcher })).rejects.toThrow('can not read any repository')
})

it('fails verification when the token exchange is refused, without leaking the key', async () => {
  const fetcher = (async () => new Response('Bad credentials', { status: 401 })) as typeof fetch
  const error = await verifyForge(app(103), { fetch: fetcher }).catch((e: Error & { status?: number }) => e)
  expect(error).toMatchObject({ status: 401 })
  expect(String(error)).not.toContain('PRIVATE KEY')
})

it('reuses one installation token per connection across backends until shortly before it expires', async () => {
  const { calls, fetcher } = forge([repo])
  await backendFor(app(104), { fetch: fetcher }).forge.listRepositories()
  await backendFor(app(104), { fetch: fetcher }).forge.listRepositories()
  expect(tokenCalls(calls)).toBe(1)
  await backendFor(app(105), { fetch: fetcher }).forge.listRepositories()
  expect(tokenCalls(calls)).toBe(2)
})

it('requests a new token once the cached one is within five minutes of expiry', async () => {
  const { calls, fetcher } = forge([repo], 60_000)
  await backendFor(app(106), { fetch: fetcher }).forge.listRepositories()
  await backendFor(app(106), { fetch: fetcher }).forge.listRepositories()
  expect(tokenCalls(calls)).toBe(2)
})

it('a GitHub connection without App ids still authenticates with its token', async () => {
  const { calls, fetcher } = forge([repo])
  const plain = { ...app(107, 'ghp_token'), config: {} }
  await backendFor(plain, { fetch: fetcher }).forge.listRepositories().catch(() => undefined)
  expect(calls[0]?.auth).toBe('Bearer ghp_token')
})

const form = (values: Record<string, string>) => (k: string) => values[k] ?? ''
const config = (values: Record<string, string>) => forgeConfig({} as Payload, 0, 'github', form(values))

it('saves App ids for the App choice and nothing for the token choice', async () => {
  await expect(config({ auth: 'app', appId: '12', installationId: '34', secret: pem }))
    .resolves.toEqual({ appId: '12', installationId: '34' })
  await expect(config({ auth: 'token', secret: 'ghp_x' })).resolves.toEqual({})
})

it('names the App fields that are missing or not numbers', async () => {
  await expect(config({ auth: 'app', appId: 'abc' })).rejects.toMatchObject({
    data: { errors: [{ path: 'appId' }, { path: 'installationId' }, { path: 'secret' }] },
  })
})
