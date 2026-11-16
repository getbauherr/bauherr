import type { ProofData } from './proof'

export const BRIEF_KINDS = ['visible', 'behaviour', 'internal'] as const
export type BriefKind = (typeof BRIEF_KINDS)[number]
export const MAX_CHANGES = 7

/** What a person approves at Accept on staging and Approve production; frozen once per merge commit (`freezeApprovalBrief` in lib/approval-brief), read from the database by pages and the gate Comment. */
export type ApprovalBrief = {
  sha: string
  changes: { text: string; kind: BriefKind }[]
  notIncluded: string[]
  risk: string
  proof: ProofData | null
  /** The review's "Noted, not sent back" items. */
  noted: { text: string; reason: string }[]
  checks: { ci: string | null; testsAdded: number | null; noProof: { rule: string; reason: string }[] }
  links: { label: string; href: string }[]
}

/** The reason shown instead of a visible change: why there is none, from the brief itself. */
export const noVisibleReason = (b: Pick<ApprovalBrief, 'changes'>): string | null => {
  if (b.changes.some((c) => c.kind === 'visible')) return null
  const first = b.changes[0]
  return first ? `Nothing a person sees changes: ${first.text}` : 'The merge request has no approval brief.'
}
