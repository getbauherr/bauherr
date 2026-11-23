import type { ReactNode } from 'react'
import type { TicketRecord } from '../../../../core/record/schema'
import type { AttachmentView } from '../../../../core/views/attachments'
import { CriteriaTable } from './CriteriaTable'
import { MockupRow } from './MockupRow'
import { Facts, Section } from './Section'
import { RefText } from '../RefText'

export const riskSentence = (risk: TicketRecord['risk']): string => {
  if (risk === null) return 'Not assessed.'
  const door = risk.door === 'one-way' ? 'Cannot be undone.' : 'Can be undone.'
  const area = risk.areas.length > 0 ? ` Area: ${risk.areas.join(', ')}.` : ''
  return `${door}${area} Rollback: ${risk.rollback}`
}

type Props = { record: TicketRecord; mockups: AttachmentView[]; missing: boolean; reason?: string }

export function BriefSheet({ record, mockups, missing, reason }: Props) {
  const { repo } = record.source
  const rows: [string, ReactNode][] = [
    [
      'Out of scope',
      record.outOfScope.length > 0 ? <RefText text={record.outOfScope.join(' ')} repo={repo} /> : 'Nothing listed.',
    ],
    ['Risk', <RefText text={riskSentence(record.risk)} repo={repo} />],
    ...(reason ? [['Why you are asked', reason] as [string, ReactNode]] : []),
  ]
  return (
    <>
      <Section title="Goal">
        <p><RefText text={record.goal} repo={repo} /></p>
      </Section>
      <MockupRow mockups={mockups} missing={missing} />
      <Section title="Acceptance criteria">
        <CriteriaTable criteria={record.criteria} repo={repo} mode="brief" />
      </Section>
      <Facts rows={rows} />
    </>
  )
}
