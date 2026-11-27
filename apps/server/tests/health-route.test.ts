import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const staleTasks = vi.hoisted(() => vi.fn<() => Promise<string[]>>())

vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('payload', () => ({ getPayload: async () => ({}) }))
vi.mock('../src/lib/health', () => ({ staleTasks }))

const raw = async (): Promise<{ status: number; body: Record<string, unknown> }> => {
  const { GET } = await import('../src/app/api/health/route')
  const res = await GET()
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

const call = async (): Promise<{ status: number; body: unknown }> => {
  const { status, body } = await raw()
  return { status, body: Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'startedAt')) }
}

beforeEach(() => {
  staleTasks.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

it('names the version and the first 7 characters of the revision', async () => {
  vi.stubEnv('BAUHERR_VERSION', '0.7.0')
  vi.stubEnv('BAUHERR_REVISION', '7e7b712abc')
  expect(await call()).toEqual({ status: 200, body: { ok: true, version: '0.7.0', commit: '7e7b712' } })
})

it('answers dev and unknown for an image built without arguments', async () => {
  vi.stubEnv('BAUHERR_VERSION', '')
  vi.stubEnv('BAUHERR_REVISION', '')
  expect(await call()).toEqual({ status: 200, body: { ok: true, version: 'dev', commit: 'unknown' } })
})

it('carries version and commit on a 503 too', async () => {
  staleTasks.mockResolvedValue(['refresh-prices'])
  vi.stubEnv('BAUHERR_VERSION', '0.7.0')
  vi.stubEnv('BAUHERR_REVISION', '7e7b712abc')
  expect(await call()).toEqual({
    status: 503,
    body: { ok: false, stale: ['refresh-prices'], version: '0.7.0', commit: '7e7b712' },
  })
})

it('names when the process started, in the past, as an ISO time', async () => {
  const { startedAt } = (await raw()).body
  expect(typeof startedAt).toBe('string')
  expect(new Date(String(startedAt)).toISOString()).toBe(startedAt)
  expect(Date.parse(String(startedAt))).toBeLessThanOrEqual(Date.now())
})
