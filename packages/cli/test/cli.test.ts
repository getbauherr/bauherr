import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CliError, portFree, preflight } from '../src/preflight.js'
import { projectName, readEnv, renderCompose, writeProject } from '../src/render.js'

const template = readFileSync(new URL('../templates/compose.yaml', import.meta.url), 'utf8')
const settings = { PORT: '3100', GATEWAY_PORT: '4100', PUBLIC_URL: 'http://localhost:3100' }
const tmp = () => mkdtempSync(join(tmpdir(), 'bauherr-cli-'))

await test('renderCompose pins the image and drops build, container names and host ports', () => {
  const out = renderCompose(template, '1.2.3')
  assert.match(out, /image: ghcr\.io\/getbauherr\/bauherr:1\.2\.3/)
  assert.doesNotMatch(
    out,
    /build: \.|container_name|"127\.0\.0\.1:(?!9090:|16686:)\d+:|_FILE: \/run\/secrets|\$\{BAUHERR_VERSION/,
  )
  assert.doesNotMatch(out, /^\s+build:|^\s+context: \.|BAUHERR_REVISION/m)
  assert.match(out, /agentgateway:v1\.7\.0@sha256:/)
  assert.match(out, /PAYLOAD_SECRET: \$\{PAYLOAD_SECRET:\?/)
  assert.match(out, /ENCRYPTION_KEY: \$\{ENCRYPTION_KEY:\?/)
  assert.match(out, /ports: \["\$\{PORT:-3000\}:3000"\]/)
  assert.match(out, /ports: \["127\.0\.0\.1:\$\{GATEWAY_PORT:-4000\}:4000"\]/)
  assert.match(out, /GATEWAY_PORT: \$\{GATEWAY_PORT:-4000\}/)
  assert.doesNotMatch(out, /"0\.0\.0\.0:|"\$\{GATEWAY_PORT:-4000\}:4000"/)
})

await test('writeProject creates secrets with mode 600 and keeps them on re-run', () => {
  const dir = tmp()
  const first = writeProject(dir, '1.2.3', settings)
  assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600)
  assert.match(first.get('PAYLOAD_SECRET')!, /^[0-9a-f]{64}$/)
  assert.notEqual(first.get('PAYLOAD_SECRET'), first.get('ENCRYPTION_KEY'))
  writeFileSync(join(dir, '.env'), readFileSync(join(dir, '.env'), 'utf8') + 'OIDC_ISSUER=https://idp\n', {
    mode: 0o644,
  })
  const second = writeProject(dir, '1.2.4', { ...settings, PORT: '3200' })
  assert.equal(second.get('PAYLOAD_SECRET'), first.get('PAYLOAD_SECRET'))
  assert.equal(second.get('ENCRYPTION_KEY'), first.get('ENCRYPTION_KEY'))
  assert.equal(second.get('COMPOSE_PROJECT_NAME'), first.get('COMPOSE_PROJECT_NAME'))
  assert.equal(readEnv(dir).get('PORT'), '3200')
  assert.equal(readEnv(dir).get('GATEWAY_PORT'), '4100')
  assert.equal(readEnv(dir).get('OIDC_ISSUER'), 'https://idp')
  assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600)
  assert.match(readFileSync(join(dir, 'compose.yaml'), 'utf8'), /bauherr:1\.2\.4/)
  assert.ok(statSync(join(dir, 'deploy/gateway/config.yaml.tmpl')).isFile())
  assert.ok(statSync(join(dir, 'deploy/db-init.sql')).isFile())
})

await test('an install without GATEWAY_PORT gets the default on re-render and keeps its other settings', () => {
  const dir = tmp()
  writeFileSync(
    join(dir, '.env'),
    'PORT=3300\nPUBLIC_URL=http://localhost:3300\nPAYLOAD_SECRET=a\nENCRYPTION_KEY=b\nOIDC_ISSUER=https://idp\n',
  )
  const rerender = () =>
    writeProject(dir, '1.2.4', {
      PORT: '3300',
      GATEWAY_PORT: readEnv(dir).get('GATEWAY_PORT') ?? '4000',
      PUBLIC_URL: 'http://localhost:3300',
    })
  const env = rerender()
  assert.equal(env.get('GATEWAY_PORT'), '4000')
  assert.equal(env.get('PAYLOAD_SECRET'), 'a')
  assert.equal(env.get('OIDC_ISSUER'), 'https://idp')
  writeFileSync(
    join(dir, '.env'),
    readFileSync(join(dir, '.env'), 'utf8').replace('GATEWAY_PORT=4000', 'GATEWAY_PORT=4010'),
  )
  assert.equal(rerender().get('GATEWAY_PORT'), '4010')
})

await test('preflight reports a busy gateway port with its own flag', async () => {
  const ok = { status: 0, missing: false }
  await assert.rejects(
    preflight(3000, { probe: () => ok, free: async (p) => p !== 4000, gatewayPort: 4000 }),
    /Port 4000 is already in use\. Pick another with --gateway-port/,
  )
  await preflight(3000, { probe: () => ok, free: async () => false, skipPort: true, gatewayPort: 4000 })
})

await test('projectName differs per install dir', () => {
  assert.match(projectName('/a/Bauherr'), /^bauherr-[0-9a-f]{6}$/)
  assert.notEqual(projectName('/a/bauherr'), projectName('/b/bauherr'))
})

await test('preflight explains missing Docker, unreachable daemon, missing compose and busy port', async () => {
  const ok = { status: 0, missing: false }
  await assert.rejects(preflight(3000, { probe: () => ({ status: null, missing: true }) }), /not installed/)
  await assert.rejects(
    preflight(3000, { probe: (a) => (a[0] === 'info' ? { status: 1, missing: false } : ok) }),
    /daemon is not reachable/,
  )
  await assert.rejects(
    preflight(3000, { probe: (a) => (a[0] === 'compose' ? { status: 1, missing: false } : ok) }),
    /Compose v2/,
  )
  await assert.rejects(
    preflight(3000, { probe: () => ok, free: async () => false }),
    (e) => e instanceof CliError && /Port 3000 is already in use/.test(e.message),
  )
  await preflight(3000, { probe: () => ok, free: async () => false, skipPort: true })
})

await test('portFree detects a listener', async () => {
  const s = createServer()
  await new Promise<void>((r) => s.listen(0, r))
  const { port } = s.address() as { port: number }
  assert.equal(await portFree(port), false)
  await new Promise((r) => s.close(r))
  assert.equal(await portFree(port), true)
})
