/** What the status words need of the stored check summary (`ciSummary`) while checks are pending. */
export type CiCounts = { passed: number; total: number; pending: number }

/** The counts of a stored summary; null without one or with nothing pending. */
export const pendingCounts = (summary: Partial<CiCounts> | null | undefined): CiCounts | null =>
  summary && summary.pending && summary.pending > 0 ? { passed: summary.passed ?? 0, total: summary.total ?? 0, pending: summary.pending } : null

/** "Waiting for CI: 1 of 2 checks passed, 1 running. The agent resumes when they finish." (DESIGN.md Activity vocabulary). */
export const waitingSentence = (c: CiCounts): string => `Waiting for CI: ${c.passed} of ${c.total} checks passed, ${c.pending} running. The agent resumes when they finish.`
