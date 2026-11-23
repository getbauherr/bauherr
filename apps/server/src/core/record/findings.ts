import type { Finding, TicketRecord } from './schema'

export const mergeFindings = (record: TicketRecord, reported: Finding[]): Finding[] => {
  const updated = new Map(reported.map((finding) => [finding.id, finding]))
  const kept = record.findings.map((finding) => updated.get(finding.id) ?? finding)
  return [...kept, ...reported.filter((finding) => !record.findings.some((f) => f.id === finding.id))]
}
