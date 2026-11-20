import { defineModule } from '../../core/module'
import type { Criterion, Finding, TicketRecord } from '../../core/record/schema'
import { verifyResultSchema, type VerifyResult } from '../../core/verify-result'

const criteriaOf = (record: TicketRecord, result: VerifyResult): Criterion[] =>
  record.criteria.map((criterion) => {
    const verified = result.criteria.find((entry) => entry.id === criterion.id)
    return verified ? { ...criterion, status: verified.status, proof: verified.proof } : criterion
  })

const findingsOf = (record: TicketRecord, result: VerifyResult): Finding[] => {
  const updated = new Map(result.findings.map((finding) => [finding.id, finding]))
  const kept = record.findings.map((finding) => updated.get(finding.id) ?? finding)
  return [...kept, ...result.findings.filter((finding) => !record.findings.some((f) => f.id === finding.id))]
}

export const verify = defineModule({
  stage: 'verify',
  role: 'verifier',
  writes: ['criteria', 'findings', 'result'],
  resultSchema: verifyResultSchema,
  gated: true,
  apply: (record, result, run) => {
    const runId = String(run.id)
    const { patchId, headSha } = result
    const event =
      result.verdict === 'pass'
        ? ({ type: 'verify.passed', data: { runId, patchId, headSha } } as const)
        : ({ type: 'verify.changes', data: { runId, patchId } } as const)
    const cost = record.result?.cost ?? { usd: 0, runs: 0, minutes: 0 }
    return {
      patch: {
        criteria: criteriaOf(record, result),
        findings: findingsOf(record, result),
        result: { changes: result.changes, walkthrough: result.walkthrough, notVerified: result.notVerified, cost },
      },
      events: [event],
    }
  },
})
