import { isWebUrl } from './url'

export type Tone = 'ok' | 'warn' | 'muted'
type SetupInput = {
  repositories: unknown[]
  sources: unknown[]
  embedTokens: { revokedAt: string }[]
  deploy: { stagingUrl: string; mode: string; webhookUrl: string; productionChecks: string }
}

/** Setup checklist rows (section id, status word, tone), the number of open steps and the "Production approval" word for the list. */
export function setupOf(p: SetupInput, productionOn: boolean) {
  const { deploy: d } = p
  const word = (done: boolean, otherwise: 'Needs setup' | 'Optional' = 'Needs setup') => (done ? 'Done' : otherwise)
  const entries: [id: string, label: string, word: string][] = [
    ['repository', 'Repository and tickets', word(p.repositories.length > 0 && p.sources.length > 0)],
    ['staging', 'Staging', word(!!d.stagingUrl && (d.mode !== 'webhook' || !!d.webhookUrl))],
    ['approvals', 'Approvals', 'Done'],
    ['production', 'Production', !productionOn ? 'Optional' : word(!!d.productionChecks)],
    ['widget', 'Website widget', word(p.embedTokens.some((e) => !e.revokedAt), 'Optional')],
  ]
  const tones: Record<string, Tone> = { Done: 'ok', 'Needs setup': 'warn', Optional: 'muted' }
  const rows = entries.map(([id, label, w]) => ({ id, label, word: w, tone: tones[w]! }))
  return {
    rows,
    open: rows.filter((r) => r.word === 'Needs setup').length,
    production: !productionOn ? 'Off' : d.productionChecks ? 'On' : 'On, needs checks',
  }
}

type Deploy = { stagingUrl: string; deployMode: string; deployWebhookUrl: string; productionWebhookUrl: string; productionGate: boolean; productionChecks: string }

const URL_MESSAGE = 'Enter an address starting with https://.'

/** Per-field messages of the Product deploy form, keyed by field name; empty when valid. */
export function deployErrors(d: Deploy): Record<string, string> {
  const e: Record<string, string> = {}
  for (const k of ['stagingUrl', 'deployWebhookUrl', 'productionWebhookUrl'] as const) if (d[k] && !isWebUrl(d[k])) e[k] = URL_MESSAGE
  if (d.deployMode === 'webhook') {
    if (!d.deployWebhookUrl) e.deployWebhookUrl = 'Required when Bauherr calls your deploy hook.'
    if (!d.stagingUrl) e.stagingUrl = 'Required: Bauherr checks this address to see the deploy finished.'
  }
  if (d.productionGate && !d.productionChecks) e.productionChecks = 'Pick the check your production deploy reports. Without it, Bauherr cannot tell when the deploy finished.'
  return e
}
