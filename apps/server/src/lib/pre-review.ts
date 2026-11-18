import { diffBudgetWarning, fakeGreenFindings, planStepCount, preReviewChecks, withProofDefaults, type ReviewChecks } from '@bauherr/runner'
import type { Payload } from 'payload'
import { PLAN_MARKER, latestWith } from '../app/(app)/lib/plan'
import { pairedImages, recordWaivers, ruleNamesWithProof } from './artifacts'
import { DEFAULT_DOCS_PATHS, DOCS_LABEL, outsideDocsPaths } from './docs-check'
import { forgeOf, id, isFactoryPr } from './release'
import { section } from './summary'

type Doc = Record<string, any>

export const BLAST_RADIUS_LADDER = ['you said so', 'read the code', 'test covers it', 'reproduced in the running app'] as const

export const blastRadiusFailures = (body: string | null | undefined): string[] => {
  const text = section(body ?? '', 'Blast radius').toLowerCase()
  const list = BLAST_RADIUS_LADDER.map((v) => `\`${v}\``).join(', ')
  if (!text) return [`The MR body has no \`## Blast radius\` section: name the one fact the change is safe because of and how sure you are, with one of ${list}`]
  const found = BLAST_RADIUS_LADDER.filter((v) => text.includes(v))
  if (found.length === 1) return []
  return [`\`## Blast radius\` ${found.length ? `names ${found.length} confidence values (${found.join(', ')})` : 'names no confidence value'}: use exactly one of ${list}`]
}

export type PreReviewReport = { failures: string[]; warnings: string[] }

export const preReviewReport = async (payload: Payload, t: Doc, evidence: string, record?: { run?: number | string }): Promise<PreReviewReport> => {
  const product = (await payload.findByID({ collection: 'products', id: id(t.product), depth: 0, overrideAccess: true })) as Doc
  const config = withProofDefaults(product.reviewChecks as ReviewChecks | null, product.pathSets)
  const docs = ((t.labels ?? []) as string[]).includes(DOCS_LABEL)
  const { backend, repo, tickets } = await forgeOf(payload, id(t.product))
  const pr = (await backend.forge.listPullRequests(repo, 'open')).find((p) => isFactoryPr(p, repo, t))
  if (!pr) return { failures: config || docs ? ['no open factory MR to check'] : [], warnings: [] }
  const plan = latestWith(await tickets.listComments(String(t.number)), PLAN_MARKER)?.body ?? ''
  const diff = await backend.forge.compare(repo, pr.base, pr.head)
  const guards = [...fakeGreenFindings(diff, plan), ...blastRadiusFailures(pr.body)]
  const large = diffBudgetWarning(diff)
  const warnings = large ? [large] : []
  const files = (await backend.forge.listPullRequestFiles(repo, pr.number)).map((f) => f.filename)
  const outside = docs ? outsideDocsPaths(files, (product.docsCheck?.paths as string[] | undefined) ?? DEFAULT_DOCS_PATHS) : []
  if (outside.length) return { failures: [`docs Ticket: ${outside.join(', ')} outside the Product's docs paths`, ...guards], warnings }
  if (!config) return { failures: guards, warnings }
  const listing = await backend.forge.listFiles(repo, pr.head)
  const tree = new Set(listing.paths)
  const artifacts = config.artifacts?.length ? await ruleNamesWithProof(payload, t.id, pr.headSha) : []
  const images = config.artifacts?.some((r) => r.pairs?.length) ? await pairedImages(payload, t.id, pr.headSha) : []
  const failures = [...preReviewChecks({ files, evidence, headSha: pr.headSha, planSteps: planStepCount(plan), artifacts, images, exists: (p) => listing.truncated || tree.has(p), config }), ...guards]
  if (record && !failures.length && config.artifacts?.length) await recordWaivers(payload, t, { run: record.run, sha: pr.headSha, evidence, config })
  return { failures, warnings }
}

export const preReviewFailures = async (...a: Parameters<typeof preReviewReport>): Promise<string[]> => (await preReviewReport(...a)).failures
