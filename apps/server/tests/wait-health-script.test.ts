import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../../../.github/scripts/wait-health.sh', import.meta.url))
const STARTED = '2026-11-27T10:00:00.000Z'

let server: Server
let url = ''

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, version: '0.7.0', commit: 'abc1234', startedAt: STARTED }))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})

afterAll(() => void server.close())

const wait = (...args: string[]): Promise<number | null> =>
  new Promise((done) => {
    spawn('bash', [script, url, 'commit', 'abc1234', '0', ...args]).on('close', done)
  })

describe('wait-health.sh', () => {
  it('accepts the target commit when no start time is required', async () => {
    expect(await wait()).toBe(0)
  })

  it('does not accept the target commit from a process that started before the deploy was triggered', async () => {
    expect(await wait('2026-11-27T10:00:05.000Z')).toBe(1)
  })

  it('accepts it once the process started after the trigger', async () => {
    expect(await wait('2026-11-27T09:59:59.000Z')).toBe(0)
  })
})
