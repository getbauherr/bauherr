import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import { CliError, portFree, preflight } from '../src/preflight.js'
import { projectName, readEnv, renderCompose, writeProject } from '../src/render.js'

const template = readFileSync(new URL('../templates/compose.yaml', import.meta.url), 'utf8')
const settings = { PORT: '3100', GATEWAY_PORT: '4100', PUBLIC_URL: 'http://localhost:3100' }
const tmp = () => mkdtempSync(join(tmpdir(), 'bauherr-cli-'))

test('renderCompose pins the image and drops build, container names and host ports', () => {
  const out = renderCompose(template, '1.2.3')
  assert.match(out, /image: ghcr\.io\/getbauherr\/bauherr:1\.2\.3/)
  assert.doesNotMatch(out, /build: \.|container_name|"127\.0\.0\.1:(?!9090:|16686:)\d+:|_FILE: \/run\/secrets|\$\{BAUHERR_VERSION/)
  // the app's whole build block (context and the BAUHERR_REVISION arg) is gone, not only a one-line `build: .`
  assert.doesNotMatch(out, /^\s+build:|^\s+context: \.|BAUHERR_REVISION/m)
  assert.match(out, /agentgateway:v1\.7\.0@sha256:/)
  assert.match(out, /PAYLOAD_SECRET: \$\{PAYLOAD_SECRET:\?/)
  assert.match(out, /ENCRYPTION_KEY: \$\{ENCRYPTION_KEY:\?/)
  assert.match(out, /ports: \["\$\{PORT:-3000\}:3000"\]/)
  assert.match(out, /ports: \["127\.0\.0\.1:\$\{GATEWAY_PORT:-4000\}:4000"\]/)
  assert.match(out, /GATEWAY_PORT: \$\{GATEWAY_PORT:-4000\}/)
  assert.doesNotMatch(out, /"0\.0\.0\.0:|"\$\{GATEWAY_PORT:-4000\}:4000"/)
})

test('observability services run only under their profile, publish only loopback UIs and keep OTLP internal', () => {
  const block = (name: string) => template.match(new RegExp(`^  ${name}:\\n((?:    .*\\n|\\s*\\n)+)`, 'm'))?.[1] ?? ''
  for (const [name, ui] of [['prometheus', '9090'], ['jaeger', '16686']] as const) {
    const b = block(name)
    assert.match(b, /profiles: \[observability\]/, name)
    assert.deepEqual([...b.matchAll(/"([^"]*:\d+:\d+)"/g)].map((m) => m[1]).filter((p) => /^\d|^\[|^127/.test(p!)).sort(), [`127.0.0.1:${ui}:${ui}`], name)
    assert.doesNotMatch(b, /"[^"]*(4317|4318)[^"]*"\s*[,\]]/, name)
  }
  assert.doesNotMatch(template.replace(/^  (prometheus|jaeger):\n(?:    .*\n)+/gm, ''), /profiles: \[observability\]/)
  const out = renderCompose(template, '1.2.3')
  assert.match(out, /"127\.0\.0\.1:9090:9090"/)
  assert.match(out, /"127\.0\.0\.1:16686:16686"/)
})

test('writeProject creates secrets with mode 600 and keeps them on re-run', () => {
  const dir = tmp()
  const first = writeProject(dir, '1.2.3', settings)
  assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600)
  assert.match(first.get('PAYLOAD_SECRET')!, /^[0-9a-f]{64}$/)
  assert.notEqual(first.get('PAYLOAD_SECRET'), first.get('ENCRYPTION_KEY'))
  writeFileSync(join(dir, '.env'), readFileSync(join(dir, '.env'), 'utf8') + 'OIDC_ISSUER=https://idp\n', { mode: 0o644 })
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

test('an install without GATEWAY_PORT gets the default on re-render and keeps its other settings', () => {
  const dir = tmp()
  writeFileSync(join(dir, '.env'), 'PORT=3300\nPUBLIC_URL=http://localhost:3300\nPAYLOAD_SECRET=a\nENCRYPTION_KEY=b\nOIDC_ISSUER=https://idp\n')
  const rerender = () => writeProject(dir, '1.2.4', { PORT: '3300', GATEWAY_PORT: readEnv(dir).get('GATEWAY_PORT') ?? '4000', PUBLIC_URL: 'http://localhost:3300' })
  const env = rerender()
  assert.equal(env.get('GATEWAY_PORT'), '4000')
  assert.equal(env.get('PAYLOAD_SECRET'), 'a')
  assert.equal(env.get('OIDC_ISSUER'), 'https://idp')
  writeFileSync(join(dir, '.env'), readFileSync(join(dir, '.env'), 'utf8').replace('GATEWAY_PORT=4000', 'GATEWAY_PORT=4010'))
  assert.equal(rerender().get('GATEWAY_PORT'), '4010')
})

test('preflight reports a busy gateway port with its own flag', async () => {
  const ok = { status: 0, missing: false }
  await assert.rejects(preflight(3000, { probe: () => ok, free: async (p) => p !== 4000, gatewayPort: 4000 }), /Port 4000 is already in use\. Pick another with --gateway-port/)
  await preflight(3000, { probe: () => ok, free: async () => false, skipPort: true, gatewayPort: 4000 })
})

test('projectName differs per install dir', () => {
  assert.match(projectName('/a/Bauherr'), /^bauherr-[0-9a-f]{6}$/)
  assert.notEqual(projectName('/a/bauherr'), projectName('/b/bauherr'))
})

test('preflight explains missing Docker, unreachable daemon, missing compose and busy port', async () => {
  const ok = { status: 0, missing: false }
  await assert.rejects(preflight(3000, { probe: () => ({ status: null, missing: true }) }), /not installed/)
  await assert.rejects(preflight(3000, { probe: (a) => (a[0] === 'info' ? { status: 1, missing: false } : ok) }), /daemon is not reachable/)
  await assert.rejects(preflight(3000, { probe: (a) => (a[0] === 'compose' ? { status: 1, missing: false } : ok) }), /Compose v2/)
  await assert.rejects(preflight(3000, { probe: () => ok, free: async () => false }), (e) => e instanceof CliError && /Port 3000 is already in use/.test(e.message))
  await preflight(3000, { probe: () => ok, free: async () => false, skipPort: true })
})

test('portFree detects a listener', async () => {
  const s = createServer()
  await new Promise<void>((r) => s.listen(0, r))
  const { port } = s.address() as { port: number }
  assert.equal(await portFree(port), false)
  await new Promise((r) => s.close(r))
  assert.equal(await portFree(port), true)
})

test('eval runs pack skill evals through the gateway, writes eval-results.json and exits 1 on a failing suite', async () => {
  const { createServer } = await import('node:http')
  const { spawn } = await import('node:child_process')
  const { mkdirSync } = await import('node:fs')
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const c of req) raw += c
    const b = JSON.parse(raw)
    const text = b.tools ? undefined : String(b.system).includes('GOOD SKILL') ? 'failing test first' : 'nothing'
    const content = text === undefined ? [{ type: 'tool_use', name: 'verdict', input: { criteria: [{ id: 'a', pass: true, reason: 'ok' }] } }] : [{ type: 'text', text }]
    res.setHeader('content-type', 'application/json').end(JSON.stringify({ content, usage: { input_tokens: 10, output_tokens: 10 } }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  const root = tmp()
  for (const [name, text] of [['good', 'GOOD SKILL'], ['bad', 'BAD SKILL']] as const) {
    mkdirSync(join(root, 'pack/skills', name, 'evals'), { recursive: true })
    writeFileSync(join(root, 'pack/skills', name, 'SKILL.md'), text)
    writeFileSync(join(root, 'pack/skills', name, 'evals/c.yaml'), 'id: c\ninput: plan\nchecks: {must_match: ["(?i)failing test"]}\nrubric:\n  - {id: a, text: A}\n')
  }
  const run = (args: string[]) => new Promise<{ code: number | null; out: string }>((resolve) => {
    const p = spawn(process.execPath, [new URL('../src/cli.js', import.meta.url).pathname, 'eval', '--skills', join(root, 'pack/skills'), ...args], { env: { ...process.env, BAUHERR_GATEWAY_URL: url, BAUHERR_GATEWAY_KEY: 'k' } })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (out += d))
    p.on('close', (code) => resolve({ code, out }))
  })
  const good = await run(['--skill', 'good', '--out', join(root, 'good.json')])
  assert.equal(good.code, 0, good.out)
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'good.json'), 'utf8')).map((r: { id: string; pass: boolean }) => [r.id, r.pass]), [['good/c', true]])
  const all = await run(['--out', join(root, 'all.json')])
  server.close()
  assert.equal(all.code, 1)
  assert.match(all.out, /bad: pass rate 0\.00 FAILED/)
  assert.equal(JSON.parse(readFileSync(join(root, 'all.json'), 'utf8')).length, 2)
})

test('apply inlines profile_file relative to the file, sends it with the key and reports findings', async () => {
  const { applyFile, exportFile, inlineProfiles } = await import('../src/factory.js')
  const dir = tmp()
  writeFileSync(join(dir, 'engineer.md'), 'Mission: "build"\nNever: x\n')
  writeFileSync(join(dir, 'factory.yaml'), 'team:\n  roles:\n    engineer: {title: E, tier: cheap, profile_file: engineer.md}\n')
  const inlined = parse(inlineProfiles(readFileSync(join(dir, 'factory.yaml'), 'utf8'), dir)) as any
  assert.equal(inlined.team.roles.engineer.profile, 'Mission: "build"\nNever: x\n')
  assert.equal(inlined.team.roles.engineer.profile_file, undefined)
  writeFileSync(join(dir, 'my notes, v2.md'), 'spaced')
  writeFileSync(join(dir, 'spaced.yaml'), 'team:\n  roles:\n    a: {title: A, tier: cheap, profile_file: "my notes, v2.md"}\n')
  assert.equal((parse(inlineProfiles(readFileSync(join(dir, 'spaced.yaml'), 'utf8'), dir)) as any).team.roles.a.profile, 'spaced')
  writeFileSync(join(dir, 'escape.yaml'), 'team:\n  roles:\n    x: {title: X, tier: cheap, profile_file: ../x.md}\n')
  assert.throws(() => inlineProfiles(readFileSync(join(dir, 'escape.yaml'), 'utf8'), dir), (e) => e instanceof CliError && /must stay inside/.test(e.message))

  const seen: { url: string; method?: string; auth: string; via: string; body?: string }[] = []
  const reply = (body: unknown, status = 200) => (async (url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>
    seen.push({ url, method: init.method, auth: h.authorization!, via: h['x-bauherr-via']!, body: init.body as string })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  const call = { url: 'http://x/', workspace: 'acme', key: 'k1', file: join(dir, 'factory.yaml'), dryRun: false }

  assert.equal(await applyFile({ ...call, fetch: reply({ ok: true, findings: [], version: 3, changed: true, migrated: [{ from: 'build', to: 'code', tickets: 2, runs: 1 }] }) }), 'applied: version 3\n  build -> code: 2 Ticket(s), 1 Run(s)')
  assert.deepEqual({ ...seen[0], body: undefined }, { url: 'http://x/api/workspaces/acme/factory', method: 'PUT', auth: 'Bearer k1', via: 'cli', body: undefined })
  assert.match(seen[0]!.body!, /profile: \|\n\s+Mission/)
  assert.equal(await applyFile({ ...call, dryRun: true, fetch: reply({ ok: true, findings: [], version: 3, changed: false, migrated: [] }) }), 'valid (no change)')
  assert.equal(seen[1]!.url, 'http://x/api/workspaces/acme/factory?dryRun=1')
  await assert.rejects(applyFile({ ...call, fetch: reply({ ok: false, findings: ['stage "a": bad'], changed: false, migrated: [] }, 422) }), (e) => e instanceof CliError && /apply failed:\n- stage "a": bad/.test(e.message))
  await assert.rejects(applyFile({ ...call, key: undefined, fetch: reply({}) }), /BAUHERR_API_KEY/)
  await assert.rejects(applyFile({ ...call, fetch: reply({ error: 'an agent key cannot change the workflow' }, 403) }), /403: an agent key/)
  assert.equal(await exportFile({ url: 'http://x', workspace: 'acme', key: 'k1', fetch: reply('version: 1\n') }), 'version: 1\n')
})
