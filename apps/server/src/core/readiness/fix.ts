import type { Payload } from 'payload'
import { CHECK_IDS, type CheckId, type Change } from './checks'
import { ReadinessInvalid } from './errors'
import type { FactsFilter } from './load'
import { findingOf } from './view'

export type SettingTarget = { pathSets: Record<string, string[]>; riskAreas: string[] }

export const checkIdOf = (value: unknown): CheckId => {
  const found = CHECK_IDS.find((id) => id === value)
  if (found === undefined) throw new ReadinessInvalid('Unknown readiness check: reload the page.')
  return found
}

export const settingData = (change: Change, product: SettingTarget): Record<string, unknown> => {
  if (change.setting === 'required-checks') return { requiredChecks: change.names.join(', ') }
  const proposed = Object.fromEntries(change.sets.map((set) => [set.name, set.paths]))
  return {
    pathSets: { ...proposed, ...product.pathSets },
    riskAreas: [...new Set([...product.riskAreas, ...change.sets.map((set) => set.name)])],
  }
}

export const proposedChange = async (payload: Payload, f: FactsFilter, check: CheckId): Promise<Change> => {
  const finding = await findingOf(payload, f, check)
  if (finding?.status !== 'gap' || finding.fix?.kind !== 'setting') {
    throw new ReadinessInvalid('This gap is gone or has no proposal any more: reload the page.')
  }
  return finding.fix.change
}
