import { STAGES, type Stage } from '../events'
import type { TicketRecord } from '../record/schema'

export type StatusInput = {
  record: TicketRecord
  stage: Stage
  pr: number | null
  changedAt: string | null
  conflict?: string | null
}

const path = (current: Stage): string =>
  STAGES.map((stage) => (stage === current ? `**${stage}**` : stage)).join(' › ')

export const renderStatus = ({ record, stage, pr, changedAt, conflict = null }: StatusInput): string => {
  const met = record.criteria.filter((criterion) => criterion.status === 'met').length
  return [
    `**Goal:** ${record.goal === '' ? 'not written yet' : record.goal}`,
    `**Stage:** ${path(stage)}`,
    `**Criteria:** ${met} of ${record.criteria.length} met`,
    `**Pull request:** ${pr === null ? 'none yet' : `#${pr}`}`,
    `**Last change:** ${changedAt ?? 'none yet'}`,
    ...(conflict === null ? [] : [`**Waiting on the author:** the branch conflicts with ${conflict}.`]),
  ].join('\n\n')
}
