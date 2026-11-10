import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { PRESETS, type Preset } from '../../src/lib/providers'

const FULL = { baseUrl: 'https://up.example/v1', awsRegion: 'us-east-1', vertexProject: 'p', vertexRegion: 'europe-west1', azureResource: 'res', azureTenant: 'tn', azureClient: 'cl' }
const SA_JSON = JSON.stringify({
  type: 'service_account', project_id: 'p', private_key_id: 'x', client_id: '1', client_email: 'a@p.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n', token_uri: 'https://oauth2.googleapis.com/token',
})
const IAM = JSON.stringify({ accessKeyId: 'AKIAXXXXXXXXXXXXXXXX', secretAccessKey: 'dummy' })
const root = join(__dirname, '../../../..')
const tmpl = readFileSync(join(root, 'deploy/gateway/config.yaml.tmpl'), 'utf8')

/** The tracing line `init` renders with OTEL_ENABLED=1 (compose.yaml), so tests check exactly what ships. */
export const TRACING_LINE = readFileSync(join(root, 'compose.yaml'), 'utf8').match(/T='(tracing: \{[^']+\})'/)![1]!.replaceAll('\\"', '"')

export const AGW_IMAGE = readFileSync(join(root, 'compose.yaml'), 'utf8').match(/cr\.agentgateway\.dev\/[^\s"]+/)![0]

/** Template with one entry per preset and both budget units; secret files are written into `dir` and referenced as `/cfg/<file>`. */
export function buildConfig(dir: string, { tracing = false } = {}): Record<string, any> {
  const cfg = parse(tmpl.replace('__GATEWAY_DATABASE_URL__', 'postgres://u:p@db:5432/gw').replace('__TRACING__', tracing ? TRACING_LINE : ''))
  cfg.config.modelCatalog = []
  for (const p of Object.keys(PRESETS) as Preset[]) {
    const file = `${p}.${PRESETS[p].secret.ext}`
    writeFileSync(join(dir, file), p === 'vertex' ? SA_JSON : 'dummy', { mode: 0o644 })
    cfg.llm.models.push(PRESETS[p].render(p, FULL, `/cfg/${file}`, p === 'bedrock-iam' ? IAM : 'dummy'))
  }
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
  return cfg
}
