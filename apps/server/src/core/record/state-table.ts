import type { Problem } from '../module'
import { STATE_OUTCOMES, type StateRow } from './schema'

const refusal = (path: string, message: string): Problem => ({ path, message: `State table: ${message}` })

export const stateTableProblems = (rows: StateRow[]): Problem[] => {
  const problems: Problem[] = []
  for (const step of new Set(rows.map((row) => row.step))) {
    const missing = STATE_OUTCOMES.filter((o) => !rows.some((row) => row.step === step && row.outcome === o))
    if (missing.length > 0) {
      problems.push(refusal('stateTable', `step "${step}" has no row for ${missing.join(', ')}: add one row each.`))
    }
  }
  const seen = new Set<string>()
  rows.forEach((row, i) => {
    if (seen.has(row.test)) {
      problems.push(refusal(`stateTable.${i}.test`, `"${row.test}" serves two rows: name one test per row.`))
    }
    seen.add(row.test)
  })
  return problems
}
