import { z } from 'zod'
import { defineModule } from '../../core/module'
import { InvalidPatch } from '../../core/record/errors'

const text = (max: number) => z.string().trim().min(1).max(max)

const selfCheck = z.object({
  criterion: z.string().regex(/^c[1-9][0-9]*$/),
  status: z.enum(['met', 'partial', 'missing']),
  pointer: text(200),
})

const resultSchema = z.object({
  pr: z.number().int().positive(),
  headSha: text(100),
  patchId: text(100),
  selfCheck: z.array(selfCheck).max(7),
  handoff: z.string().trim().min(1).max(1200),
  addressed: z.array(z.string().regex(/^f[1-9][0-9]*$/)).max(20).default([]),
})

export const build = defineModule({
  stage: 'build',
  role: 'builder',
  writes: ['handoff', 'findings'],
  resultSchema,
  apply: (record, result, run) => {
    const checked = result.selfCheck.map((entry) => entry.criterion).sort()
    const wanted = record.criteria.map((criterion) => criterion.id).sort()
    if (JSON.stringify(checked) !== JSON.stringify(wanted)) {
      throw new InvalidPatch(`selfCheck must have one entry per criterion (${wanted.join(', ')}): fix the list.`)
    }
    const unknown = result.addressed.filter((id) => !record.findings.some((finding) => finding.id === id))
    if (unknown.length > 0) {
      throw new InvalidPatch(`addressed names findings the record does not have (${unknown.join(', ')}): fix the ids.`)
    }
    const findings = record.findings.map((finding) =>
      result.addressed.includes(finding.id) && finding.status === 'open'
        ? { ...finding, status: 'fixing' as const }
        : finding,
    )
    const data = { runId: String(run.id), patchId: result.patchId, headSha: result.headSha, pr: result.pr }
    return { patch: { handoff: result.handoff, findings }, events: [{ type: 'build.submitted', data }] }
  },
})
