import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const scripts = fileURLToPath(new URL('../../../.github/scripts/', import.meta.url))
const TIP = 'b'.repeat(40)

const run = (script: string, args: string[], env: Record<string, string> = {}) =>
  new Promise<{ code: number | null; out: string }>((done) => {
    const child = spawn('bash', [join(scripts, script), ...args], { env: { ...process.env, ...env } })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()))
    child.on('close', (code) => done({ code, out: out.trim() }))
  })

describe('is-tip.sh', () => {
  let bin = ''

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), 'fake-gh-'))
    const gh = join(bin, 'gh')
    const cases = ['repos/o/r) echo trunk;;', `repos/o/r/commits/trunk) echo ${TIP};;`, '*) exit 1;;']
    writeFileSync(gh, `#!/bin/sh\ncase "$2" in\n${cases.join('\n')}\nesac\n`)
    chmodSync(gh, 0o755)
  })

  const tip = (sha: string) =>
    run('is-tip.sh', [sha], { PATH: `${bin}:${process.env.PATH ?? ''}`, GITHUB_REPOSITORY: 'o/r' })

  it('says true for the tip of the default branch', async () => {
    expect(await tip(TIP)).toEqual({ code: 0, out: 'true' })
  })

  it('says false for a sha that a newer merge has passed', async () => {
    expect(await tip('a'.repeat(40))).toEqual({ code: 0, out: 'false' })
  })
})

describe('trigger-time.sh', () => {
  let server: Server
  let url = ''

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, version: '0.7.0' }))
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })

  afterAll(() => void server.close())

  it('prints no time when the site already runs the requested version, so no restart is required', async () => {
    expect(await run('trigger-time.sh', [url, 'version', '0.7.0'])).toEqual({ code: 0, out: '' })
  })

  it('prints the time of the trigger for a different version', async () => {
    const { code, out } = await run('trigger-time.sh', [url, 'version', '0.8.0'])
    expect(code).toBe(0)
    expect(out).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/)
  })

  it('prints the time of the trigger when the site does not answer', async () => {
    const { out } = await run('trigger-time.sh', ['http://127.0.0.1:1', 'version', '0.7.0'])
    expect(out).toMatch(/^\d{4}-/)
  })
})
