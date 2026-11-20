import type { TicketRecord } from '../../../../core/record/schema'
import { CriteriaTable } from './CriteriaTable'
import { Facts, Section } from './Section'

export const riskSentence = (risk: TicketRecord['risk']): string => {
  if (risk === null) return 'Not assessed.'
  const door = risk.door === 'one-way' ? 'Cannot be undone.' : 'Can be undone.'
  const area = risk.areas.length > 0 ? ` Area: ${risk.areas.join(', ')}.` : ''
  return `${door}${area} Rollback: ${risk.rollback}`
}

export function BriefSheet({ record, reason }: { record: TicketRecord; reason?: string }) {
  const rows: [string, string][] = [
    ['Out of scope', record.outOfScope.length > 0 ? record.outOfScope.join(' ') : 'Nothing listed.'],
    ['Risk', riskSentence(record.risk)],
    ...(reason ? [['Why you are asked', reason] as [string, string]] : []),
  ]
  return (
    <>
      <Section title="Goal">
        <p>{record.goal}</p>
      </Section>
      <Section title="Acceptance criteria">
        <CriteriaTable criteria={record.criteria} mode="brief" />
      </Section>
      <Facts rows={rows} />
    </>
  )
}
