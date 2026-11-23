import { z } from 'zod'
import { defineModule, type Applied } from '../../core/module'
import { InvalidPatch } from '../../core/record/errors'
import type { TicketRecord } from '../../core/record/schema'
import type { Run } from '../../core/run/schema'

const text = (max: number) => z.string().trim().min(1).max(max)

const selfCheck = z.object({
  criterion: z.string().regex(/^c[1-9][0-9]*$/),
  status: z.enum(['met', 'partial', 'missing']),
  pointer: text(200),
})

const built = z.object({
  pr: z.number().int().positive(),
  headSha: text(100),
  patchId: text(100),
  selfCheck: z.array(selfCheck).max(7),
  handoff: z.string().trim().min(1).max(1200),
  addressed: z.array(z.string().regex(/^f[1-9][0-9]*$/)).max(20).default([]),
})

const alreadyDone = z.object({
  alreadyDone: z.object({
    by: z.string().regex(/^#[1-9][0-9]*$/, 'name the covering pull request or Ticket as #<number>'),
    evidence: text(600),
  }),
})

const resultSchema = z.union([built, alreadyDone])

const reportedDone = (record: TicketRecord, result: z.infer<typeof alreadyDone>, run: Run): Applied => {
  const { by, evidence } = result.alreadyDone
  const asked = {
    reason: 'already-done',
    options: ['close-as-done', 're-run-build'],
    text: `Close #${record.source.number} as done by ${by}?`,
  }
  return {
    patch: {},
    events: [
      { type: 'build.already-done', data: { runId: String(run.id), by, evidence } },
      { type: 'question.asked', data: asked },
    ],
  }
}

export const build = defineModule({
  stage: 'build',
  role: 'builder',
  writes: ['handoff', 'findings'],
  resultSchema,
  apply: (record, result, run) => {
    if ('alreadyDone' in result) return reportedDone(record, result, run)
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
