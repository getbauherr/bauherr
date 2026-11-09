import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { PRESETS } from '../src/lib/providers'
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
