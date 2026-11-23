import { defineModule } from '../../core/module'
import { mergeFindings } from '../../core/record/findings'
import type { Criterion, TicketRecord } from '../../core/record/schema'
import { reviewText } from '../../core/forge/review-text'
import { verifyResultSchema, type VerifyResult } from '../../core/verify-result'

const criteriaOf = (record: TicketRecord, result: VerifyResult): Criterion[] =>
  record.criteria.map((criterion) => {
    const verified = result.criteria.find((entry) => entry.id === criterion.id)
    return verified ? { ...criterion, status: verified.status, proof: verified.proof } : criterion
  })

export const verify = defineModule({
  stage: 'verify',
  role: 'verifier',
  writes: ['criteria', 'findings', 'result'],
  resultSchema: verifyResultSchema,
  gated: true,
  apply: (record, result, run, { state }) => {
    const runId = String(run.id)
    const { patchId, headSha } = result
    const event =
      result.verdict === 'pass'
        ? ({ type: 'verify.passed', data: { runId, patchId, headSha } } as const)
        : ({ type: 'verify.changes', data: { runId, patchId } } as const)
    const cost = record.result?.cost ?? { usd: 0, runs: 0, minutes: 0 }
    const criteria = criteriaOf(record, result)
    const findings = mergeFindings(record, result.findings)
    const review = state.adopted && state.patch !== null && result.verdict === 'changes'
    const body = review ? reviewText(headSha, findings, criteria) : null
    return {
      patch: {
        criteria,
        findings,
        result: { changes: result.changes, walkthrough: result.walkthrough, notVerified: result.notVerified, cost },
      },
      events: [event],
      effects: body !== null && state.patch !== null ? [{ kind: 'review', pr: state.patch.pr, body }] : [],
    }
  },
})
