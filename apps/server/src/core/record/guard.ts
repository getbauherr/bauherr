import type { Stage } from '../events'
import { CriteriaEditNotAllowed, FieldNotWritable, ProofRequired, StatusChangeNotAllowed } from './errors'
import type { Criterion, RecordField, TicketRecord } from './schema'

export type PatchBy = { stage: Stage; runId: string }

const sameStructure = (before: Criterion, after: Criterion): boolean =>
  JSON.stringify([before.id, before.text, before.verify]) === JSON.stringify([after.id, after.text, after.verify])

const sameWording = (a: Criterion, b: Criterion): boolean =>
  JSON.stringify([a.text, a.verify]) === JSON.stringify([b.text, b.verify])

const findBefore = (before: Criterion[], criterion: Criterion, by: PatchBy): Criterion | undefined =>
  by.stage === 'brief'
    ? before.find((b) => sameWording(b, criterion))
    : before.find((b) => b.id === criterion.id)

export const carryOverVerdicts = (before: Criterion[], after: Criterion[]): Criterion[] =>
  after.map((criterion) => {
    const same = before.find((b) => sameWording(b, criterion))
    return same && criterion.status === 'open' && criterion.proof.length === 0
      ? { ...criterion, status: same.status, proof: same.proof }
      : criterion
  })

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
    checkStatus(findBefore(before, criterion, by), criterion, by)
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
