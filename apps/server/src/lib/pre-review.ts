import { planStepCount, preReviewChecks, type ReviewChecks } from '@bauherr/runner'
import type { Payload } from 'payload'
import { PLAN_MARKER, latestWith } from '../app/(app)/lib/plan'
import { forgeOf, id, isFactoryPr } from './release'

type Doc = Record<string, any>

/** Failure lines of the Product's `reviewChecks` for the Ticket's open factory MR; `evidence` is the Run's Evidence. Empty when the Product has no rules. */
export const preReviewFailures = async (payload: Payload, t: Doc, evidence: string): Promise<string[]> => {
  const product = (await payload.findByID({ collection: 'products', id: id(t.product), depth: 0, overrideAccess: true })) as Doc
  const config = product.reviewChecks as ReviewChecks | null
  if (!config) return []
  const { backend, repo, tickets } = await forgeOf(payload, id(t.product))
  const pr = (await backend.forge.listPullRequests(repo, 'open')).find((p) => isFactoryPr(p, repo, t.number))
  if (!pr) return ['no open factory MR to check']
  const files = (await backend.forge.listPullRequestFiles(repo, pr.number)).map((f) => f.filename)
  const listing = await backend.forge.listFiles(repo, pr.head)
  const tree = new Set(listing.paths)
  const plan = latestWith(await tickets.listComments(String(t.number)), PLAN_MARKER)?.body ?? ''
  return preReviewChecks({ files, evidence, planSteps: planStepCount(plan), exists: (p) => listing.truncated || tree.has(p), config })
}
