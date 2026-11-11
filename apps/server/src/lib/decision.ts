import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { type Need, NEEDS } from './needs-you'
import { GRAPH_CHECKPOINT, SKILL_NEED, checkpointOfNeed } from './checkpoints'
import { workflowFor } from './factory'
import { productionGateOn } from './mode'
import { stage } from './workflow'
import { cas, id } from './release'
import { bullets, section } from './summary'
import { type Tpl, packTemplate, renderTemplate } from './templates'
import { parseTldr, type PlanTldr } from './tldr'

/** The decisions that show the proof: accepting on staging and approving production. */
export const PROOF_NEEDS: readonly string[] = ['Accept on staging', 'Staging not confirmed', 'Approve production', 'Production deploy failed']

export type DecisionAction = 'approvePlan' | 'requestChanges' | 'acceptStaging' | 'approveProduction' | 'grantRound' | 'stopReview' | 'backToBuild' | 'backToBacklog' | 'rerun' | 'expedite' | 'decide' | 'approveSkill' | 'rejectSkill' | 'open'
export type DecisionOption = { label: string; action: DecisionAction; primary?: boolean; destructive?: boolean; /** The option takes a one-line note first. */ note?: 'required' | 'optional'; /** `open` only: where it is done. */ href?: string; /** `decide` only: the outcome of the `human` stage it takes. */ outcome?: string; effect: string }
export type Decision = {
  need: Need | typeof SKILL_NEED
  checkpoint: Checkpoint
  title: string
  ask: string
  recommendation: string | null
  why: string[]
  options: DecisionOption[]
  next: string
  evidence: { label: string; url: string }[]
  details?: string
  preparedBy: 'factory' | 'agent'
  preparedAt: string
  openSince: string
}

/** The checkpoints in workflow order: the Workflow graph's checkpoint titles (`checkpoints.ts`) and the groups of the needs that are no graph node. */
export const CHECKPOINTS = ['Triage', GRAPH_CHECKPOINT.refine, GRAPH_CHECKPOINT.plan, 'Review', GRAPH_CHECKPOINT.staging, GRAPH_CHECKPOINT.production, 'Decision', 'Skill proposal', 'Stuck'] as const
export type Checkpoint = (typeof CHECKPOINTS)[number]

/** What the sweep (or the Inbox, for a Ticket the sweep has not reached yet) knows without reading the forge. */
export type DecisionFacts = {
  ticket: { id: number | string; number?: number; title: string; stage?: string | null; reviewRounds?: number | null; openCriticalDecisions?: number | null; releaseRunUrl?: string | null; releasedIn?: string | null }
  product: { id: number | string; name?: string; stagingUrl?: string | null }
  run?: { id: number | string; stage: string; status: string; error?: string | null; reasonKind?: string | null; verdict?: string | null; findings?: { severity: string; file?: string; line?: number; msg: string }[] | null } | null
  mrUrl?: string | null
  planTldr?: PlanTldr | null
  stagingTldr?: { whatYouGet: string; found: string } | null
  productionGate?: boolean
  /** The custom `human` stage the Ticket waits in: its title and outcome keys (the options of a "Decision needed"). */
  human?: { title: string; outcomes: string[] } | null
  /** The distilled skill a person is asked to merge (`Approve skill proposal`). */
  skill?: { name: string; score: number | null; baseline: number | null; pr: number | null } | null
  now?: string
  /** The stored decision, so `openSince` survives a rebuild of the same need. */
  previous?: Pick<Decision, 'need' | 'openSince'> | null
}

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`)
const one = (s: string): string => s.replace(/\s+/g, ' ').trim()
const s = (n: number): string => (n === 1 ? '' : 's')
/** `prefix "title" suffix`, the title shortened so the sentence stays within 120 characters. */
const sentence = (prefix: string, title: string, suffix = ''): string => `${prefix} "${clip(one(title), Math.max(10, 118 - prefix.length - suffix.length - 3))}"${suffix}`.slice(0, 120)
const SEVERITY = ['high', 'medium', 'low']

/** The Decision of one need: a pure function of what is already stored, so the sweep needs no forge read and the Inbox and the Ticket page say the same. */
export const buildDecision = (need: Need | typeof SKILL_NEED, f: DecisionFacts): Decision => {
  const { ticket: t, product: p, run, planTldr: plan, stagingTldr: stg } = f
  const now = f.now ?? new Date().toISOString()
  const findings = (run?.findings ?? []).filter((x) => x.severity !== 'low')
  const cap = (t.reviewRounds ?? 0) > 0 ? t.reviewRounds! : 0
  const reason = run?.error ? clip(one(run.error), 200) : null
  const stage = run?.stage ?? t.stage ?? 'current'
  const tid = String(t.id)
  const open = (label: string, href: string, effect: string, primary = true): DecisionOption => ({ label, action: 'open', href, primary, effect })
  const rerun: DecisionOption = { label: `Re-run ${stage}`, action: 'rerun', primary: true, effect: 'A new attempt starts with the same goal.' }
  const accept = (label: string): DecisionOption[] => [
    { label, action: 'acceptStaging', primary: true, effect: f.productionGate ? 'The change counts as accepted; the production approval is asked next.' : 'The ticket is done.' },
    { label: 'Request changes', action: 'requestChanges', note: 'required', effect: 'The ticket goes back to build with your note.' },
  ]
  const evidence = [
    ...(f.mrUrl ? [{ label: 'Change', url: f.mrUrl }] : []),
    ...(p.stagingUrl && ['Accept on staging', 'Staging not confirmed'].includes(need) ? [{ label: 'Staging', url: p.stagingUrl }] : []),
    ...(t.releaseRunUrl && need === 'Release failed' ? [{ label: 'Release workflow', url: t.releaseRunUrl }] : []),
    ...(run && ['Run needs you', 'Run failed', 'Cancelled', 'Needs you'].includes(need) ? [{ label: `Run ${run.id}`, url: `/runs/${run.id}` }] : []),
  ]
  const x = ((): Pick<Decision, 'ask' | 'recommendation' | 'why' | 'options' | 'next' | 'details'> => {
    switch (need) {
      case 'Approve plan': {
        const noSummary = !plan
        return {
          ask: sentence('Approve the plan for', t.title),
          recommendation: plan ? clip(one(plan.recommendation), 200) : null,
          why: plan ? plan.why.slice(0, 3).map((w) => clip(one(w), 160)) : ['The plan has no summary; open it to read it.'],
          options: [{ label: 'Approve plan', action: 'approvePlan', primary: true, effect: 'Build starts when a slot is free.' }, { label: 'Read the plan', action: 'open', href: `/tickets/${tid}#plan`, effect: 'Opens the full plan; comment on the ticket to change it.' }],
          next: 'Build starts when a slot is free.',
          details: noSummary ? undefined : [`**Risk:** ${plan.risk}`, ...(plan.options.length ? ['', '**Options**', ...plan.options.map((o) => `- ${o}`)] : [])].join('\n'),
        }
      }
      case 'Answer decisions': {
        const n = t.openCriticalDecisions ?? 0
        return {
          ask: n ? `Answer ${n} critical question${s(n)} before the plan can be approved` : 'Answer the critical questions before the plan can be approved',
          recommendation: 'Take the recommended default of each question unless it is wrong for you; every question has one.',
          why: [n ? `${n} critical question${s(n)} still open` : 'Critical questions are still open', 'Approving the plan is blocked until they are answered'],
          options: [open('Answer questions', `/tickets/${tid}#answer`, 'Opens the questions with their defaults.')],
          next: 'You can then approve the plan.',
        }
      }
      case 'Answer questions':
        return {
          ask: sentence('Answer the questions Triage asked about', t.title),
          recommendation: 'Take the recommended default of each question unless it is wrong for you; every question has one.',
          why: ['Planning is on hold until the questions are answered', 'Each question names what a wrong default would cost'],
          options: [open('Answer questions', `/tickets/${tid}#answer`, 'Opens the questions with their defaults.')],
          next: 'Planning starts when all are answered.',
        }
      case 'Accept on staging':
      case 'Staging not confirmed': {
        const unconfirmed = need === 'Staging not confirmed'
        const got = stg ? bullets(stg.whatYouGet).slice(0, 2).map((b) => clip(one(b), 160)) : []
        const found = stg ? bullets(stg.found).filter((b) => !/^nothing recorded\.?$/i.test(b))[0] : undefined
        return {
          ask: sentence(unconfirmed ? 'Check on staging yourself:' : 'Check on staging and accept', t.title),
          recommendation: unconfirmed ? 'Open staging and check that the new version runs, then accept; the factory did not see the deploy.' : 'Accept after a quick look: the change passed review and its checks before it was merged.',
          why: [...(unconfirmed ? ['The deploy was not seen within 60 minutes'] : []), ...got, ...(found ? [`Found on the way: ${clip(one(found), 140)}`] : [])].slice(0, 3),
          options: accept(unconfirmed ? 'Accept anyway' : 'Accept on staging'),
          next: f.productionGate ? 'The change counts as accepted; the production approval is asked next.' : 'The ticket is done.',
          details: stg?.found.trim() ? `**Found on the way**\n${stg.found.trim()}` : undefined,
        }
      }
      case 'Configure production checks':
        return {
          ask: `Configure the production checks of ${clip(one(p.name ?? 'this product'), 60)}`,
          recommendation: 'Add the names of the checks that report your production deploy.',
          why: ['Production approval is on, but this product has no production checks', 'Without them the factory cannot see whether a deploy worked'],
          options: [open('Configure checks', `/settings/products/${p.id}?tab=deploy#production`, 'Opens the product settings.')],
          next: 'The production approval can then be asked for.',
        }
      case 'Approve production':
        return {
          ask: sentence('Approve the production deploy of', t.title),
          recommendation: 'Approve: the change was accepted on staging.',
          why: ['Accepted on staging', "The product's own pipeline does the deploy"],
          options: [{ label: 'Approve production', action: 'approveProduction', primary: true, effect: 'The deploy starts; the factory watches it.' }],
          next: 'The deploy starts; the factory watches it.',
        }
      case 'Production deploy failed':
        return {
          ask: sentence('Retry the failed production deploy of', t.title),
          recommendation: 'Check the deploy log, then approve again; the pipeline runs from the same commit.',
          why: ['The deploy failed or was not reported in time'],
          options: [{ label: 'Approve again', action: 'approveProduction', primary: true, effect: 'The deploy runs again.' }],
          next: 'The deploy runs again; the factory watches it.',
        }
      case 'Release failed':
        return {
          ask: sentence('Re-run the failed release workflow of', t.title),
          recommendation: 'Re-run the release workflow; the change itself is already merged.',
          why: ['The image or npm workflow failed or did not finish'],
          options: [open('Open workflow run', t.releaseRunUrl || `/tickets/${tid}#details`, 'Opens the workflow run on the forge; re-run it there.')],
          next: 'Once the workflow passes, the release is recorded.',
        }
      case 'Round cap reached': {
        const counts = SEVERITY.slice(0, 2).map((v) => [v, findings.filter((x) => x.severity === v).length] as const).filter(([, n]) => n)
        return {
          ask: sentence('Give the review one more round, or stop', t.title),
          recommendation: findings.length ? 'Give it one more round: the open findings are concrete and build can fix them on the same change.' : null,
          why: [`Reviewed and sent back ${cap || 'several'} times`, ...(findings.length ? [`${findings.length} open finding${s(findings.length)} (${counts.map(([v, n]) => `${n} ${v}`).join(', ')})`] : []), ...(findings[0] ? [clip(one(findings[0].msg), 140)] : [])].slice(0, 3),
          options: [
            { label: 'Give one more round', action: 'grantRound', primary: true, effect: 'Build fixes the findings on the same change; review runs again.' },
            { label: 'Stop', action: 'stopReview', destructive: true, note: 'optional', effect: 'The change stays open; the ticket goes back to triage.' },
          ],
          next: 'Build fixes the findings on the same change, then review runs again.',
          details: findings.length ? findings.slice(0, 8).map((x) => `- [${x.severity}] ${x.file ? `${x.file}${x.line ? `:${x.line}` : ''} ` : ''}${clip(one(x.msg), 200)}`).join('\n') : undefined,
        }
      }
      case 'Needs you':
        return {
          ask: sentence('Decide how the review of', t.title, ' goes on'),
          recommendation: 'Send it back to build with a note on what to change.',
          why: [reason ?? 'The review could not conclude on its own, for example because the change was closed or its checks stayed red'],
          options: [{ label: 'Back to build', action: 'backToBuild', primary: true, note: 'optional', effect: 'Build starts again with your note.' }],
          next: 'Build starts again with your note.',
        }
      case 'Run needs you':
      case 'Run failed': {
        const failed = need === 'Run failed'
        const rec = run?.reasonKind === 'access' ? 'Fix the missing access, then re-run it.' : run?.reasonKind === 'decision' ? 'Decide what the step asks for, then re-run it.' : 'Read the reason, then re-run it.'
        return {
          ask: sentence(failed ? `Re-run the failed ${stage} step of` : `Unblock the ${stage} step of`, t.title),
          recommendation: failed ? 'Re-run it once; if it fails again, the reason shows what to fix.' : rec,
          why: [reason ?? (failed ? 'The step failed after the factory retried it on a stronger model' : 'The step stopped and says it needs a person')],
          options: [rerun],
          next: 'A new attempt starts with the same goal.',
          details: run?.error && run.error.length > 200 ? run.error : undefined,
        }
      }
      case 'Cancelled':
        return {
          ask: sentence(`Restart the cancelled ${stage} step of`, t.title),
          recommendation: 'Re-run it unless you cancelled it on purpose; then send the ticket back to the backlog.',
          why: [reason ?? 'The step was cancelled before it finished'],
          options: [rerun, { label: 'Back to backlog', action: 'backToBacklog', destructive: true, effect: 'The ticket is untriaged again and is planned from the start.' }],
          next: 'A new attempt starts.',
        }
      case 'Decision needed': {
        const h = f.human ?? { title: stage, outcomes: [] }
        const label = (k: string) => k.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
        return {
          ask: sentence(`Decide the ${h.title} step of`, t.title),
          recommendation: null,
          why: [`The ticket waits in the "${h.title}" stage for a person`],
          options: h.outcomes.map((o, i): DecisionOption => ({ label: label(o), action: 'decide' as const, outcome: o, primary: i === 0, effect: `The ticket follows the outcome "${o}" of this stage.` })).concat(h.outcomes.length ? [] : [open('Open the ticket', `/tickets/${tid}`, 'Decide on the ticket page.')]),
          next: 'The ticket moves on by the outcome you pick.',
        }
      }
      case SKILL_NEED: {
        const k = f.skill
        const pct = (n: number | null | undefined) => (n == null ? 'n/a' : `${Math.round(n * 100)}%`)
        return {
          ask: sentence('Merge the skill', k?.name ?? 'a new skill', ` learned from #${t.number ?? t.id}`),
          recommendation: 'Approve if the replay score beats the baseline and the skill reads right.',
          why: [`Replay score ${pct(k?.score)} against ${pct(k?.baseline)} without the skill`, ...(k?.pr != null ? [`Knowledge pull request #${k.pr}`] : [])],
          options: [
            { label: 'Approve skill proposal', action: 'approveSkill', primary: true, effect: 'Merges the Knowledge pull request; agents use the skill from their next Run.' },
            { label: 'Reject', action: 'rejectSkill', destructive: true, note: 'optional', effect: 'Closes the pull request; nothing is merged.' },
          ],
          next: 'The skill is merged into the Knowledge repo, or the proposal is closed.',
        }
      }
      case 'Expedite?':
        return {
          ask: sentence('Move into the Expedite lane:', t.title),
          recommendation: 'Expedite only if users are affected right now; otherwise skip it.',
          why: ['Triage proposes the Expedite lane for this ticket', 'The lane skips the queue and the plan approval'],
          options: [{ label: 'Expedite', action: 'expedite', primary: true, effect: 'The ticket jumps the queue and needs no plan approval.' }],
          next: 'The ticket jumps the queue and needs no plan approval.',
        }
    }
  })()
  return {
    need,
    checkpoint: checkpointOfNeed(need) as Checkpoint,
    title: t.title,
    ...x,
    evidence,
    preparedBy: need === 'Approve plan' && plan ? 'agent' : need === 'Accept on staging' && stg ? 'agent' : 'factory',
    preparedAt: now,
    openSince: f.previous?.need === need ? f.previous.openSince : now,
  }
}

/** The decision without its timestamps: what makes two builds "the same" for the sweep's write-only-on-change. */
export const sameDecision = (a: Decision | null | undefined, b: Decision | null | undefined): boolean => {
  const strip = (d: Decision | null | undefined) => (d ? JSON.stringify({ ...d, preparedAt: undefined, openSince: undefined }) : null)
  return strip(a) === strip(b)
}

export const DECIDED_GRACE_MS = 2 * 60_000

/** Whether the sweep must not reopen `need`: the owner decided it a moment ago and the forge side has not caught up. */
export const justDecided = (t: { decidedAt?: string | null; decidedNeed?: string | null }, need: Need | null, at = Date.now()): boolean =>
  !!need && t.decidedNeed === need && !!t.decidedAt && at - Date.parse(t.decidedAt) < DECIDED_GRACE_MS

/** The owner took the Ticket's decision: clears `needsYou` and `decision` at once (conditional, so a newer need is never cleared) and remembers what was decided. */
export const settleDecision = (payload: Payload, ticket: number | string): Promise<boolean> =>
  cas(payload, ticket, sql`"decided_need" = "needs_you", "decided_at" = now(), "needs_you" = NULL, "decision" = NULL`, sql`"needs_you" IS NOT NULL`)

/** Whether the person may decide the need: an Expedite is an Admin's, every other checkpoint belongs to the Workspace's members (as the Ticket page's buttons). */
export const canDecide = (user: { role?: string | null }, need: Need | typeof SKILL_NEED): boolean => (need !== 'Expedite?' && need !== SKILL_NEED) || user.role === 'admin'

export const isNeed = (v: unknown): v is Need => (NEEDS as readonly unknown[]).includes(v)

type Doc = Record<string, any>

/** The `human` stage a Ticket row sits in (its Workspace's workflow), for the options of its "Decision needed". */
export const humanStage = (t: Doc): { title: string; outcomes: string[] } | null => {
  const def = t.stage ? stage(workflowFor(t.workspace), t.stage) : undefined
  return def?.kind === 'human' ? { title: def.title, outcomes: def.outcomeOrder ?? Object.keys(def.outcomes) } : null
}

/** The Decision of a Ticket row for the sweep: the Product and the newest MR link are the only extra reads, none of them on the forge. */
export const prepareDecision = async (payload: Payload, t: Doc, need: Need, run: Doc | null): Promise<Decision> => {
  const o = { overrideAccess: true, depth: 0 } as const
  const [product, builds] = await Promise.all([
    payload.findByID({ collection: 'products', id: id(t.product), ...o }) as Promise<Doc>,
    payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { kind: { equals: 'build' } }] }, sort: '-createdAt', limit: 5, select: { artifacts: true }, ...o }),
  ])
  const mrUrl = (builds.docs as Doc[]).map((r) => r.artifacts?.prUrl as string | undefined).find(Boolean) ?? null
  return buildDecision(need, { ticket: t as DecisionFacts['ticket'], product: product as DecisionFacts['product'], run: run as DecisionFacts['run'], mrUrl, planTldr: t.planTldr, stagingTldr: t.stagingTldr, productionGate: productionGateOn(workflowFor(t.workspace), product), human: humanStage(t), previous: t.decision })
}

/** Stores the plan's parsed TL;DR (null when it has none) so pages and the sweep read it from the Ticket row. */
export const storePlanTldr = (payload: Payload, ticket: number | string, plan: string, heading?: string): Promise<boolean> => {
  const json = JSON.stringify(parseTldr(plan, heading).tldr)
  return cas(payload, ticket, sql`"plan_tldr" = ${json}::jsonb`, sql`"plan_tldr" IS DISTINCT FROM ${json}::jsonb`)
}

/** The first two sections of a staging summary: what the owner gets and what was found on the way. */
export const stagingTldrOf = (summary: string, headings = { whatYouGet: 'What you get', found: 'Found on the way' }): { whatYouGet: string; found: string } => ({ whatYouGet: section(summary, headings.whatYouGet), found: section(summary, headings.found) })

export const storeStagingTldr = (payload: Payload, ticket: number | string, tldr: { whatYouGet: string; found: string }): Promise<boolean> => {
  const json = JSON.stringify(tldr)
  return cas(payload, ticket, sql`"staging_tldr" = ${json}::jsonb`, sql`"staging_tldr" IS DISTINCT FROM ${json}::jsonb`)
}

/** The decision as the markdown of the `decision` template: the Comment that notifies a person, and what the chat reads. */
export const decisionMarkdown = (d: Decision, tpl: Tpl = packTemplate('decision'), proof?: string): string =>
  renderTemplate(tpl, {
    decision: d.ask,
    ...(d.recommendation ? { recommendation: d.recommendation } : {}),
    ...(d.why.length ? { why: d.why.map((w) => `- ${w}`).join('\n') } : {}),
    ...(proof ? { proof } : {}),
    options: d.options.map((o) => `- **${o.label}**: ${o.effect}`).join('\n'),
    next: d.next,
  })
