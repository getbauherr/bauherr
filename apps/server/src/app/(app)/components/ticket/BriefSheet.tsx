import type { ReactNode } from 'react'
import type { TicketRecord } from '../../../../core/record/schema'
import type { AttachmentView } from '../../../../core/views/attachments'
import { diffLines } from '../../../../core/record/diff'
import { CriteriaTable } from './CriteriaTable'
import { DiffBlock } from './DiffBlock'
import { MermaidBlock } from './MermaidBlock'
import { MockupRow } from './MockupRow'
import { Collapsible, Facts, Section } from './Section'
import { RefText } from '../RefText'

export const riskSentence = (risk: TicketRecord['risk']): string => {
  if (risk === null) return 'Not assessed.'
  const door = risk.door === 'one-way' ? 'Cannot be undone.' : 'Can be undone.'
  const area = risk.areas.length > 0 ? ` Area: ${risk.areas.join(', ')}.` : ''
  return `${door}${area} Rollback: ${risk.rollback}`
}

type Props = {
  record: TicketRecord
  mockups: AttachmentView[]
  missing: boolean
  reason?: string
  decisions?: ReactNode
}

export function BriefSheet({ record, mockups, missing, reason, decisions }: Props) {
  const { repo } = record.source
  const rows: [string, ReactNode][] = [
    [
      'Out of scope',
      record.outOfScope.length > 0 ? <RefText text={record.outOfScope.join(' ')} repo={repo} /> : 'Nothing listed.',
    ],
    ...(reason ? [['Why you are asked', reason] as [string, ReactNode]] : []),
  ]
  return (
    <>
      <Section title="Goal">
        <p><RefText text={record.goal} repo={repo} /></p>
      </Section>
      {record.shape !== '' && (
        <Section title="Shape">
          <DiffBlock lines={diffLines(record.shape)} label="Shape of the change" />
        </Section>
      )}
      {record.flow !== '' && (
        <Section title="Flow">
          <MermaidBlock source={record.flow} />
        </Section>
      )}
      <MockupRow mockups={mockups} missing={missing} />
      {decisions}
      <Collapsible title="Acceptance criteria">
        <CriteriaTable criteria={record.criteria} repo={repo} mode="brief" />
      </Collapsible>
      {record.plan.steps.length > 0 && (
        <Collapsible title="Plan">
          <ol className="m-0 grid gap-1 pl-5">
            {record.plan.steps.map((step) => <li key={step}><RefText text={step} repo={repo} /></li>)}
          </ol>
        </Collapsible>
      )}
      <Collapsible title="Risk">
        <p className="m-0"><RefText text={riskSentence(record.risk)} repo={repo} /></p>
      </Collapsible>
      <Facts rows={rows} />
    </>
  )
}
