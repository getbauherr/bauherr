import type { Stage } from '../events'
import { CriteriaEditNotAllowed, FieldNotWritable, ProofRequired, StatusChangeNotAllowed } from './errors'
import type { Criterion, RecordField, TicketRecord } from './schema'

export type PatchBy = { stage: Stage; runId: string }

const sameStructure = (before: Criterion, after: Criterion): boolean =>
  JSON.stringify([before.id, before.text, before.verify]) === JSON.stringify([after.id, after.text, after.verify])

const checkStatus = (before: Criterion | undefined, after: Criterion, by: PatchBy): void => {
  const was = before?.status ?? 'open'
  if (after.status === was) return
  if (by.stage !== 'verify') {
    throw new StatusChangeNotAllowed(
      `Criterion ${after.id} changes status in stage ${by.stage}: ` +
        'only a verify run records criterion status; leave status as it is.',
    )
  }
  if ((after.status === 'met' || after.status === 'partial') && after.proof.length === 0) {
    throw new ProofRequired(
      `Criterion ${after.id} cannot become ${after.status} without proof: ` +
        'add at least one proof id in the same patch.',
    )
  }
}

const checkCriteria = (before: Criterion[], after: Criterion[], by: PatchBy): void => {
  const structural =
    before.length !== after.length || before.some((criterion, i) => !after[i] || !sameStructure(criterion, after[i]))
  if (structural && by.stage !== 'brief') {
    throw new CriteriaEditNotAllowed(
      `Criteria are added or reworded in stage ${by.stage}: only the brief stage edits them; record a finding instead.`,
    )
  }
  for (const criterion of after) {
    checkStatus(before.find((b) => b.id === criterion.id), criterion, by)
  }
}

export const checkWrites = (patch: Partial<TicketRecord>, writes: RecordField[]): void => {
  const refused = Object.keys(patch).filter((field) => !writes.some((w) => w === field))
  if (refused.length > 0) {
    throw new FieldNotWritable(
      `Field ${refused.join(', ')} is not in the writes of this patch: ` +
        'list it in writes, or leave it out of the patch.',
    )
  }
}

export const checkPatch = (current: TicketRecord, next: TicketRecord, by: PatchBy): void => {
  if (JSON.stringify(current.criteria) !== JSON.stringify(next.criteria)) {
    checkCriteria(current.criteria, next.criteria, by)
  }
}
