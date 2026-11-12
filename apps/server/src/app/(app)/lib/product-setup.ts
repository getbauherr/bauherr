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

export type Callout = { tone: Tone; lead: string; text: string }

/**
 * The production status callouts, most important first. `seen` holds the check names found on recent commits, or null when the forge could not be read (then a named check counts as ready, with a note that it is not confirmed).
 * `notifiable` is false when no Bauherr or Admin of the Workspace has a linked forge login.
 */
export function productionCallouts({ on, checks, seen, notifiable }: { on: boolean; checks: string[]; seen: string[] | null; notifiable: boolean }): Callout[] {
  if (!on) return [{ tone: 'muted', lead: 'Off', text: 'Once you accept on staging, the Ticket is done. Nothing waits for you before production.' }]
  const out: Callout[] = []
  const names = checks.join(', ')
  if (!checks.length) out.push({ tone: 'warn', lead: 'Not ready', text: 'Pick the check that reports your production deploy. Until then Tickets stop at Configure production checks.' })
  else if (seen && !checks.every((c) => seen.includes(c))) {
    const missing = checks.filter((c) => !seen.includes(c))
    out.push({ tone: 'warn', lead: 'Almost ready', text: `${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} not reported on recent commits. After you approve, Bauherr waits 60 minutes for ${missing.length === 1 ? 'it' : 'them'}, then stops the deploy as timed out.` })
  } else out.push({ tone: 'ok', lead: 'Ready', text: `After you accept on staging, Approve production appears on the Ticket. Bauherr then watches ${names}.${seen ? '' : ' GitHub could not be read, so the names are not confirmed.'}` })
  if (!notifiable) out.push({ tone: 'warn', lead: 'No approver', text: 'Nobody gets a GitHub notification. Link a forge login on a Bauherr or Admin under People.' })
  return out
}

/** Comma-separated check names as a list. */
export const namesOf = (v: string): string[] => v.split(',').map((c) => c.trim()).filter(Boolean)

/** GitHub Actions workflow for the label-triggered production deploy; it reports every check in `checks` on the Ticket's merge commit, not on the latest default branch commit. Names go through an env block, never into the shell command; `${{` is dropped so a name cannot inject an expression. */
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
