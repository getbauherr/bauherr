import { linkLabel } from '@bauherr/adapters'

/** What the status words need of the stored check summary (`ciSummary`) while checks are pending. */
export type CiCounts = { passed: number; total: number; pending: number }

/** The counts of a stored summary; null without one or with nothing pending. */
export const pendingCounts = (summary: Partial<CiCounts> | null | undefined): CiCounts | null =>
  summary && summary.pending && summary.pending > 0 ? { passed: summary.passed ?? 0, total: summary.total ?? 0, pending: summary.pending } : null

/** "Waiting for CI: 1 of 2 checks passed, 1 running. The agent resumes when they finish." (DESIGN.md Activity vocabulary). */
export const waitingSentence = (c: CiCounts): string => `Waiting for CI: ${c.passed} of ${c.total} checks passed, ${c.pending} running. The agent resumes when they finish.`

/** The chip of a Ticket whose checks run: n of m checks have finished (passed or failed). */
export const waitingChip = (c: CiCounts): string => `Waiting for CI ${c.total - c.pending}/${c.total}`

/** The forge link button of a Ticket or Run: the MR url labelled from the Product's Connection kind (stored, no secret, no adapter, no forge call). Null without a web url. */
export const forgeLinkOf = (kind: string | null | undefined, url: string | null | undefined): { href: string; label: string } | null => {
  let n: string | undefined
  try {
    const u = new URL(url ?? '')
    if (!/^https?:$/.test(u.protocol)) return null
    n = /(\d+)\/?$/.exec(u.pathname)?.[1]
  } catch {
    return null
  }
  return { href: url!, label: n ? linkLabel(kind, Number(n)) : 'Open merge request' }
}

/** Label of a link to the CI checks (DESIGN.md Forge link button: "CI checks on GitHub"); "CI checks" for an unknown forge. */
export const ciLinkLabel = (kind: string | null | undefined): string => (kind === 'github' ? 'CI checks on GitHub' : kind === 'gitlab' ? 'CI checks on GitLab' : 'CI checks')
