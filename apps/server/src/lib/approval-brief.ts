import type { Forge } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { type ApprovalBrief, type BriefKind, MAX_CHANGES, noVisibleReason } from '../app/(app)/lib/brief'
import type { ProofData } from '../app/(app)/lib/proof'
import { summarize } from './ci-summary'
import { cas } from './release'
import { bullets, section } from './summary'

export { BRIEF_KINDS, MAX_CHANGES, noVisibleReason, type ApprovalBrief, type BriefKind } from '../app/(app)/lib/brief'

const KIND = /^(?:[[(*]+)?(visible|behaviou?r|internal)(?:[\])*]+)?\s*[:\-–—]?\s*(.+)$/i
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export const parseApprovalBrief = (body: string): Pick<ApprovalBrief, 'changes' | 'notIncluded' | 'risk'> => {
  const parts = new Map<string, string[]>()
  let current: string[] | null = null
  for (const line of section(body ?? '', 'Approval brief').split('\n')) {
    const head = /^###\s+(.+?)\s*$/.exec(line)
    if (head) parts.set((head[1] as string).toLowerCase(), (current = []))
    else current?.push(line)
  }
  const part = (name: string) => [...parts].find(([k]) => k.startsWith(name))?.[1].join('\n') ?? ''
  const changes = bullets(part('what changes')).slice(0, MAX_CHANGES).map((b) => {
    const m = KIND.exec(b)
    const kind = (m?.[1]?.toLowerCase().replace('behavior', 'behaviour') ?? 'internal') as BriefKind
    return { text: clip((m?.[2] ?? b).trim(), 300), kind }
  })
  return { changes, notIncluded: bullets(part('not included')).map((b) => clip(b, 300)), risk: clip(part('risk').trim().replace(/\s*\n\s*/g, ' '), 600) }
}

const quiet = (s: string) => s.replace(/@(?=\w)/g, '@\u200b')
const list = (items: string[]) => items.map((i) => `- ${quiet(i)}`).join('\n')

export const approvalBriefMarkdown = (b: ApprovalBrief): string => {
  const reason = noVisibleReason(b)
  return [
    '**What changes for whom**',
    reason ? `No visible change. ${reason}` : '',
    b.changes.length ? list(b.changes.map((c) => `[${c.kind}] ${c.text}`)) : '',
    `**Not included**\n${b.notIncluded.length ? list(b.notIncluded) : 'Nothing listed.'}`,
    `**Risk and rollback**\n${quiet(b.risk) || 'Not stated.'}`,
    `**Checks**\n${list([
      b.checks.ci ?? 'CI: unknown',
      b.checks.testsAdded == null ? 'Tests added: unknown' : `Tests added: ${b.checks.testsAdded}`,
      ...b.checks.noProof.map((p) => `No proof for ${p.rule}: ${p.reason || 'no reason given'}`),
      ...b.noted.map((n) => `Noted, not sent back: ${n.text} (${n.reason})`),
    ])}`,
  ].filter(Boolean).join('\n\n')
}

export const storeApprovalBrief = (payload: Payload, ticket: number | string, brief: ApprovalBrief): Promise<boolean> =>
  cas(payload, ticket, sql`"approval_brief" = ${JSON.stringify(brief)}::jsonb`, sql`"approval_brief"->>'sha' IS DISTINCT FROM ${brief.sha}`)

type Doc = Record<string, any>
const TEST_FILE = /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\./

export const freezeApprovalBrief = async (a: { mergeSha: string | null; mrs: { number: number; url: string; body: string }[]; runs: Doc[]; forge: Forge; repo: string; stagingUrl: string | null; proof: ProofData | null }): Promise<ApprovalBrief> => {
  const parsed = a.mrs.map((m) => parseApprovalBrief(m.body)).find((p) => p.changes.length || p.risk || p.notIncluded.length) ?? { changes: [], notIncluded: [], risk: '' }
  const review = a.runs.find((r) => r.kind === 'review' && r.status === 'succeeded')
  const mr = a.mrs[0]
  const [checks, files] = await Promise.all([
    a.mergeSha ? a.forge.listChecks(a.repo, a.mergeSha).catch(() => null) : null,
    mr ? a.forge.listPullRequestFiles(a.repo, mr.number).catch(() => null) : null,
  ])
  const ci = checks && summarize(checks, null)
  return {
    sha: a.mergeSha ?? '',
    ...parsed,
    proof: a.proof,
    noted: ((review?.artifacts?.review?.open ?? []) as { text: string; reason: string }[]).map(({ text, reason }) => ({ text, reason })),
    checks: {
      ci: ci ? `CI: ${ci.passed} of ${ci.total} checks passed${ci.failed.length ? `, failed: ${ci.failed.join(', ')}` : ''}` : null,
      testsAdded: files ? files.filter((f) => f.status === 'added' && TEST_FILE.test(f.filename)).length : null,
      noProof: [...(a.proof?.rows.filter((r) => !r.items.length).map((r) => ({ rule: r.criterion ?? 'other proof', reason: 'No proof attached' })) ?? []), ...(a.proof?.waived ?? [])],
    },
    links: [...a.mrs.map((m) => ({ label: `Merge request #${m.number}`, href: m.url })), ...(a.stagingUrl ? [{ label: 'Staging', href: a.stagingUrl }] : []), ...a.runs.filter((r) => r.kind === 'build').slice(0, 3).map((r) => ({ label: `Run #${r.id}`, href: `/runs/${r.id}` }))],
  }
}
