import { defineModule } from '../../core/module'
import { mergeFindings } from '../../core/record/findings'
import { reviewResultSchema } from '../../core/review-result'

export const review = defineModule({
  stage: 'verify',
  role: 'reviewer',
  writes: ['findings'],
  resultSchema: reviewResultSchema,
  gated: true,
  apply: (record, result, run) => {
    const { patchId, headSha } = result
    const findings = result.findings.filter((finding) => finding.status === 'open').length
    return {
      patch: { findings: mergeFindings(record, result.findings) },
      events: [{ type: 'review.submitted', data: { runId: String(run.id), patchId, headSha, findings } }],
    }
  },
})
