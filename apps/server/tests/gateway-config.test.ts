import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { PRESETS, type Preset } from '../src/lib/providers'

const dockerAvailable = spawnSync('docker', ['version']).status === 0
const FULL = { baseUrl: 'https://up.example/v1', awsRegion: 'us-east-1', vertexProject: 'p', vertexRegion: 'europe-west1', azureResource: 'res', azureTenant: 'tn', azureClient: 'cl' }
const SA_JSON = JSON.stringify({
  type: 'service_account', project_id: 'p', private_key_id: 'x', client_id: '1', client_email: 'a@p.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n', token_uri: 'https://oauth2.googleapis.com/token',
})
const IAM = JSON.stringify({ accessKeyId: 'AKIAXXXXXXXXXXXXXXXX', secretAccessKey: 'dummy' })
const tmpl = readFileSync(join(__dirname, '../../../deploy/gateway/config.yaml.tmpl'), 'utf8')

it.skipIf(!dockerAvailable)('the template with one entry per preset and both budget units passes agentgateway --validate-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agw-'))
  const cfg = parse(tmpl.replace('__GATEWAY_DATABASE_URL__', 'postgres://u:p@db:5432/gw').replace('__TRACING__', ''))
  cfg.config.modelCatalog = []
  for (const p of Object.keys(PRESETS) as Preset[]) {
    const file = `${p}.${PRESETS[p].secret.ext}`
    writeFileSync(join(dir, file), p === 'vertex' ? SA_JSON : 'dummy', { mode: 0o644 })
    cfg.llm.models.push(PRESETS[p].render(p, FULL, `/cfg/${file}`, p === 'bedrock-iam' ? IAM : 'dummy'))
  }
  // One Workspace, two Connections: entries `ws-multi/a/*` and `ws-multi/b/*`.
  for (const c of ['a', 'b']) {
    writeFileSync(join(dir, `multi-${c}.key`), 'dummy', { mode: 0o644 })
    cfg.llm.models.push(PRESETS.anthropic.render(`multi/${c}`, FULL, `/cfg/multi-${c}.key`))
  }
  cfg.llm.policies.apiKey.keys = [
    { key: 'sk-usd', metadata: { name: 'usd' }, allowedModels: ['ws-anthropic/*'], budgets: [{ name: 'monthly', limit: { unit: 'USD', amount: 50 }, window: { rolling: '30d' }, onBudgetExceeded: 'Block' }] },
    { key: 'sk-tok', metadata: { name: 'tok' }, allowedModels: ['ws-greenpt/*'], budgets: [{ name: 'monthly', limit: { unit: 'Tokens', amount: 20_000_000 }, window: { rolling: '30d' }, onBudgetExceeded: 'Block' }] },
  ]
  chmodSync(dir, 0o755)
  writeFileSync(join(dir, 'config.yaml'), stringify(cfg), { mode: 0o644 })
  const r = spawnSync('docker', ['run', '--rm', '-v', `${dir}:/cfg:ro`, 'cr.agentgateway.dev/agentgateway:v1.6.0', '--validate-only', '-f', '/cfg/config.yaml'], { encoding: 'utf8' })
  expect(r.status, r.stderr + r.stdout).toBe(0)
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
