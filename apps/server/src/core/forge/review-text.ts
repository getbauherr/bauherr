import type { Criterion, Finding } from '../record/schema'

export const reviewText = (headSha: string, findings: Finding[], criteria: Criterion[]): string => {
  const open = findings.filter((finding) => finding.status === 'open')
  const unmet = criteria.filter((criterion) => ['open', 'partial', 'missing'].includes(criterion.status))
  const lines = [
    ...open.map((finding) => `- ${finding.text} (${finding.evidence.kind}: ${finding.evidence.pointer})`),
    ...unmet.map((criterion) => `- ${criterion.text} (${criterion.status})`),
  ]
  return [`Verification of ${headSha.slice(0, 7)} asks for changes:`, ...lines].join('\n')
}
