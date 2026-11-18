import { linkLabel } from '@bauherr/adapters'

export type CiCounts = { passed: number; total: number; pending: number }

export const pendingCounts = (summary: Partial<CiCounts> | null | undefined): CiCounts | null =>
  summary && summary.pending && summary.pending > 0 ? { passed: summary.passed ?? 0, total: summary.total ?? 0, pending: summary.pending } : null

export const waitingSentence = (c: CiCounts): string => `Waiting for CI: ${c.passed} of ${c.total} checks passed, ${c.pending} running. The agent resumes when they finish.`

export const waitingChip = (c: CiCounts): string => `Waiting for CI ${c.total - c.pending}/${c.total}`

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

export const ciLinkLabel = (kind: string | null | undefined): string => (kind === 'github' ? 'CI checks on GitHub' : kind === 'gitlab' ? 'CI checks on GitLab' : 'CI checks')
