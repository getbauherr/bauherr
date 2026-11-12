import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { PRESETS, type Preset } from '../src/lib/providers'
import { buildConfig } from './helpers/gateway-config'

it('the template with one entry per preset and both budget units is a structurally valid gateway config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agw-'))
  const cfg = buildConfig(dir)
  const text = stringify(cfg)
  expect(parse(text)).toEqual(cfg)
  expect(text).not.toMatch(/__[A-Z_]+__/)
  const models: { name: string }[] = cfg.llm.models
  const names = models.map((m) => m.name)
  expect(new Set(names).size).toBe(names.length)
  expect(names.filter((n) => n.startsWith('ws-'))).toHaveLength(Object.keys(PRESETS).length + 2)
  for (const k of cfg.llm.policies.apiKey.keys) {
    for (const pat of k.allowedModels as string[]) expect(names.some((n) => n.startsWith(pat.replace(/\*$/, ''))), pat).toBe(true)
    for (const b of k.budgets) {
      expect(['USD', 'Tokens']).toContain(b.limit.unit)
      expect(b.limit.amount).toBeGreaterThan(0)
      expect(b.onBudgetExceeded).toBe('Block')
    }
  }
  for (const f of text.match(/\/cfg\/[\w.-]+/g) ?? []) expect(existsSync(join(dir, f.slice(5))), f).toBe(true)
})

it.each(Object.keys(PRESETS) as Preset[])('%s: the secret lands in config.yaml only for inline auth, never in the rendered entry otherwise', (p) => {
  const def = PRESETS[p]
  const secret = p === 'bedrock-iam' ? JSON.stringify({ accessKeyId: 'AKIA-SECRET-MARK', secretAccessKey: 'SECRET-MARK' }) : 'SECRET-MARK'
  const entry = JSON.stringify(def.render(p, { baseUrl: 'https://up.example/v1', awsRegion: 'us-east-1', vertexProject: 'p', vertexRegion: 'r', azureResource: 'res', azureTenant: 'tn', azureClient: 'cl' }, `/cfg/${p}.${def.secret.ext}`, def.auth === 'inline' ? secret : undefined))
  if (def.auth === 'inline') expect(entry).toContain('SECRET-MARK')
  else expect(entry).not.toContain('SECRET-MARK')
  if (def.auth === 'file') expect(entry).toContain(`/cfg/${p}.${def.secret.ext}`)
  if (def.auth === 'ambient') expect(entry).not.toContain('/cfg/')
})

it('inline secrets are written into config.yaml, never into a provider file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agw-'))
  buildConfig(dir)
  expect(readFileSync(join(dir, 'config.yaml'), 'utf8')).toContain('AKIAXXXXXXXXXXXXXXXX')
  for (const f of readdirSync(dir).filter((x) => x !== 'config.yaml')) expect(readFileSync(join(dir, f), 'utf8'), f).not.toContain('AKIAXXXXXXXXXXXXXXXX')
})

it('with OTEL_ENABLED=1 init renders frontendPolicies.tracing with sampling on (v1.7.0 samples nothing by default), not the deprecated config.tracing', () => {
  const cfg = buildConfig(mkdtempSync(join(tmpdir(), 'agw-')), { tracing: true })
  expect(cfg.config.tracing).toBeUndefined()
  expect(cfg.frontendPolicies.tracing).toEqual({ host: 'jaeger:4317', randomSampling: true })
  expect(cfg.frontendPolicies.accessLog).toBeDefined()
  expect(buildConfig(mkdtempSync(join(tmpdir(), 'agw-'))).frontendPolicies.tracing).toBeUndefined()
})

it('a gateway admin call that never answers fails within the timeout', async () => {
  const { createServer } = await import('node:http')
  const srv = createServer(() => {}).listen(0)
  await new Promise((r) => srv.once('listening', r))
  process.env.GATEWAY_ADMIN_URL = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
  process.env.GATEWAY_ADMIN_TIMEOUT_MS = '50'
  try {
    const { deleteKey } = await import('../src/lib/gateway')
    await expect(deleteKey('x')).rejects.toThrow('gateway GET')
  } finally {
    delete process.env.GATEWAY_ADMIN_URL
    delete process.env.GATEWAY_ADMIN_TIMEOUT_MS
    srv.closeAllConnections()
    srv.close()
  }
}, 20_000)

it('the rendered config logs the session fields and serves the owner login under claude-* and sub/*, with every key header stripped', () => {
  const cfg = buildConfig(mkdtempSync(join(tmpdir(), 'agw-')))
  expect(cfg.frontendPolicies.accessLog.database.add).toEqual({
    run: 'request.headers["x-bauherr-run"]',
    stage: 'request.headers["x-bauherr-stage"]',
    product: 'request.headers["x-bauherr-product"]',
    ticket: 'request.headers["x-bauherr-ticket"]',
    session: 'request.headers["x-bauherr-session"]',
    role: 'request.headers["x-bauherr-role"]',
    client: 'coalesce(request.headers["x-bauherr-client"], request.headers["user-agent"])',
  })
  expect(cfg.frontendPolicies.accessLog.database.llm).toBe('metadata')
  const models = cfg.llm.models as { name: string; authorization?: unknown; requestHeaders: { remove: string[] } }[]
  expect(models.map((m) => m.name).filter((n) => !n.startsWith('ws-'))).toEqual(['sub/*', 'claude-*'])
  for (const m of models) expect(m.requestHeaders.remove, m.name).toEqual(expect.arrayContaining(['x-agw-key', 'x-api-key', 'x-goog-api-key']))
  for (const n of ['sub/*', 'claude-*']) expect(models.find((m) => m.name === n)!.authorization).toEqual({ rules: [{ allow: 'apiKey.kind == "owner-session"' }] })
  expect(cfg.llm.policies.apiKey.location.expression).toContain('x-goog-api-key')
})

it('ensureManaged brings an older config up to date, adds claude-* once and lists every catalog file', async () => {
  const { ensureManaged, KEY_LOCATION } = await import('../src/lib/gateway')
  const cfg = {
    config: { modelCatalog: [{ file: '/gateway/catalogs/anthropic.json' }] },
    frontendPolicies: { accessLog: { database: { llm: 'metadata', add: { run: 'request.headers["x-bauherr-run"]' } } } },
    llm: {
      policies: { apiKey: { location: { expression: 'coalesce(request.headers["x-agw-key"], request.headers["authorization"].stripPrefix("Bearer "))' } } },
      models: [{ name: 'sub/*', provider: 'anthropic', transformation: { model: 'x' }, requestHeaders: { remove: ['x-agw-key'] } }, { name: 'ws-a/anthropic/*', provider: 'anthropic' }],
    },
  } as Record<string, any>
  expect(ensureManaged(cfg, ['anthropic.json', 'base-costs.json'])).toBe(true)
  expect(Object.keys(cfg.frontendPolicies.accessLog.database.add)).toEqual(['run', 'session', 'role', 'client'])
  expect(cfg.llm.policies.apiKey.location.expression).toBe(KEY_LOCATION)
  expect(cfg.llm.models.map((m: { name: string }) => m.name)).toEqual(['sub/*', 'claude-*', 'ws-a/anthropic/*'])
  expect(cfg.llm.models[1].transformation).toBeUndefined()
  expect(cfg.llm.models[1].requestHeaders.remove).toEqual(['x-agw-key', 'x-api-key', 'x-goog-api-key'])
  expect(cfg.config.modelCatalog.map((c: { file: string }) => c.file.split('/').pop())).toEqual(['anthropic.json', 'base-costs.json'])
  expect(ensureManaged(cfg, ['anthropic.json', 'base-costs.json'])).toBe(false)
})
