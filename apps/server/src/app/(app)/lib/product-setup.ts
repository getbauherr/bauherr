import { isWebUrl } from './url'

export type Tone = 'ok' | 'warn' | 'muted'
type SetupInput = {
  repositories: unknown[]
  sources: unknown[]
  deploy: { stagingUrl: string; mode: string; webhookUrl: string; productionGate: boolean; productionChecks: string }
}

export function setupOf(p: SetupInput) {
  const { deploy: d } = p
  const word = (done: boolean, otherwise: 'Needs setup' | 'Optional' = 'Needs setup') => (done ? 'Done' : otherwise)
  const entries: [id: string, label: string, word: string][] = [
    ['repository', 'Repository and tickets', word(p.repositories.length > 0 && p.sources.length > 0)],
    ['staging', 'Staging', word(!!d.stagingUrl && (d.mode !== 'webhook' || !!d.webhookUrl))],
    ['production', 'Production', !d.productionGate ? 'Optional' : word(!!d.productionChecks)],
  ]
  const tones: Record<string, Tone> = { Done: 'ok', 'Needs setup': 'warn', Optional: 'muted' }
  const rows = entries.map(([id, label, w]) => ({ id, label, word: w, tone: tones[w]! }))
  return {
    rows,
    open: rows.filter((r) => r.word === 'Needs setup').length,
    production: !d.productionGate ? 'Off' : d.productionChecks ? 'On' : 'On, needs checks',
  }
}

type Deploy = { stagingUrl: string; deployMode: string; deployWebhookUrl: string; productionWebhookUrl: string; productionGate: boolean; productionChecks: string }

const URL_MESSAGE = 'Enter an address starting with https://.'

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

export type Callout = { tone: Tone; lead: string; text: string }

export function productionCallouts({ checks, seen }: { checks: string[]; seen: string[] | null }): Callout[] {
  const out: Callout[] = []
  const names = checks.join(', ')
  if (!checks.length) out.push({ tone: 'warn', lead: 'Not ready', text: 'Pick the check that reports your production deploy. Until then production approvals cannot be tracked.' })
  else if (seen && !checks.every((c) => seen.includes(c))) {
    const missing = checks.filter((c) => !seen.includes(c))
    out.push({ tone: 'warn', lead: 'Almost ready', text: `${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} not reported on recent commits. After you approve, Bauherr waits 60 minutes for ${missing.length === 1 ? 'it' : 'them'}, then stops the deploy as timed out.` })
  } else out.push({ tone: 'ok', lead: 'Ready', text: `Bauherr watches ${names} after you approve production.${seen ? '' : ' GitHub could not be read, so the names are not confirmed.'}` })
  return out
}

export const namesOf = (v: string): string[] => v.split(',').map((c) => c.trim()).filter(Boolean)

export const productionWorkflow = (checks: string[]): string => `name: Deploy production
on:
  issues:
    types: [labeled]
permissions:
  checks: write
  contents: read
  pull-requests: read
jobs:
  deploy:
    if: github.event.label.name == 'bauherr:approved:production' && !github.event.issue.pull_request
    runs-on: ubuntu-latest
    env:
      GH_TOKEN: \${{ github.token }}
      CHECKS: |
${checks.map((c) => `        ${c.replace(/\$\{\{/g, '').replace(/[\r\n]/g, ' ')}`).join('\n')}
    steps:
      - name: Find the merge commit of the Ticket
        id: ticket
        run: |
          sha=$(gh pr list --repo "$GITHUB_REPOSITORY" --state merged --limit 200 --json headRefName,mergeCommit \\
            --jq '[.[] | select(.headRefName | startswith("bauherr/\${{ github.event.issue.number }}-"))][0].mergeCommit.oid')
          echo "sha=$sha" >> "$GITHUB_OUTPUT"
      - name: Deploy
        run: ./deploy.sh "\${{ steps.ticket.outputs.sha }}"
      - name: Report the checks on that commit
        env:
          SHA: \${{ steps.ticket.outputs.sha }}
        run: |
          while IFS= read -r name; do
            [ -n "$name" ] && gh api "repos/$GITHUB_REPOSITORY/check-runs" -f name="$name" -f head_sha="$SHA" -f status=completed -f conclusion=success
          done <<< "$CHECKS"
`
