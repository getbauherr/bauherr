import type { Problem } from './module'
import type { Criterion, TicketRecord } from './record/schema'
import type { VerifyResult } from './verify-result'

export type ChecksState = 'passed' | 'failed' | 'pending' | 'none'

export type GateFacts = {
  buildClaimedBy: string | null
  verifyHeldBy: string | null
  patch: { id: string; headSha: string } | null
  headCommit: string | null
  checks: ChecksState
  proofIds: string[]
}

export type GateInput = { result: VerifyResult; record: TicketRecord; facts: GateFacts }
export type GateOutcome = { accepted: true } | { accepted: false; refusals: Problem[] }

type Rule = (input: GateInput) => Problem[]

const refusal = (rule: string, path: string, message: string): Problem => ({
  path,
  message: `Gate ${rule}: ${message}`,
})

const author: Rule = ({ facts }) =>
  facts.buildClaimedBy !== null && facts.buildClaimedBy === facts.verifyHeldBy
    ? [refusal('author', '', 'this session built the patch, and a verdict needs a non-author: release the run.')]
    : []

const stalePatch: Rule = ({ result, facts }) =>
  facts.patch?.id === result.patchId && facts.patch.headSha === result.headSha
    ? []
    : [refusal('stale-patch', 'patchId', 'the result is not for the latest patch: verify the patch of the record.')]

const headMoved: Rule = ({ result, facts }) =>
  facts.headCommit === result.headSha
    ? []
    : [refusal('head-moved', 'headSha', 'the pull request head is not headSha: re-read it and verify that commit.')]

export const CHECKS_FIX = 'wait for green checks, or mark it open'

const claims = (status: string): boolean => status === 'met' || status === 'partial'

const kindOf = (record: TicketRecord, id: string): Criterion['verify']['kind'] | undefined =>
  record.criteria.find((criterion) => criterion.id === id)?.verify.kind

const checks: Rule = ({ result, record, facts }) => {
  if (facts.checks === 'passed' || facts.checks === 'none') return []
  return result.criteria
    .filter((c) => claims(c.status) && ['test', 'command'].includes(kindOf(record, c.id) ?? ''))
    .map((c) => {
      const why = `${c.id} is verified by a test or command but the checks are ${facts.checks}`
      return refusal('checks', `criteria.${c.id}`, `${why}: ${CHECKS_FIX}.`)
    })
}

const proof: Rule = ({ result, facts }) =>
  result.criteria
    .filter((c) => claims(c.status) && (c.proof.length === 0 || c.proof.some((p) => !facts.proofIds.includes(p))))
    .map((c) => {
      const why = `${c.id} is ${c.status} without a proof of this record`
      return refusal('proof', `criteria.${c.id}`, `${why}: attach a proof and name its id.`)
    })

const known: Rule = ({ result, record }) =>
  result.criteria
    .filter((c) => !record.criteria.some((criterion) => criterion.id === c.id))
    .map((c) => refusal('criterion', `criteria.${c.id}`, `${c.id} is not a criterion of the record: use its ids.`))

const evidence: Rule = ({ result }) =>
  result.findings
    .filter((f) => f.evidence.pointer.trim() === '')
    .map((f) => {
      const fix = 'add a failing test or a reproduction'
      return refusal('evidence', `findings.${f.id}`, `${f.id} has no evidence pointer: ${fix}.`)
    })

const verdict: Rule = ({ result, record }) => {
  if (result.verdict !== 'pass') return []
  const statusOf = (c: Criterion) => result.criteria.find((r) => r.id === c.id)?.status ?? c.status
  const unmet = record.criteria.filter((c) => ['open', 'partial', 'missing'].includes(statusOf(c)))
  const findings = new Map([...record.findings, ...result.findings].map((f) => [f.id, f]))
  const live = [...findings.values()].filter((f) => f.status === 'open' || f.status === 'fixing')
  const parts = [...unmet.map((c) => c.id), ...live.map((f) => f.id)]
  return parts.length === 0
    ? []
    : [refusal('verdict', 'verdict', `pass while ${parts.join(', ')} are not settled: answer changes, or settle them.`)]
}

const RULES: Rule[] = [author, stalePatch, headMoved, checks, proof, known, evidence, verdict]

export const gate = (input: GateInput): GateOutcome => {
  const refusals = RULES.flatMap((rule) => rule(input))
  return refusals.length === 0 ? { accepted: true } : { accepted: false, refusals }
}
