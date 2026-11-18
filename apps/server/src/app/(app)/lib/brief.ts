import type { ProofData } from './proof'

export const BRIEF_KINDS = ['visible', 'behaviour', 'internal'] as const
export type BriefKind = (typeof BRIEF_KINDS)[number]
export const MAX_CHANGES = 7

export type ApprovalBrief = {
  sha: string
  changes: { text: string; kind: BriefKind }[]
  notIncluded: string[]
  risk: string
  proof: ProofData | null
  noted: { text: string; reason: string }[]
  checks: { ci: string | null; testsAdded: number | null; noProof: { rule: string; reason: string }[] }
  links: { label: string; href: string }[]
}

export const noVisibleReason = (b: Pick<ApprovalBrief, 'changes'>): string | null => {
  if (b.changes.some((c) => c.kind === 'visible')) return null
  const first = b.changes[0]
  return first ? `Nothing a person sees changes: ${first.text}` : 'The merge request has no approval brief.'
}
