import type { Payload } from 'payload'
import { cloneRepo, commitAndPush, git, mergeBase, patchId } from '@bauherr/runner'
import { connectionInput } from './connection'
import { escalate, rebindReview, returnConflictToBuild } from './actions'
import { gitAccess } from './run-ctx'
import { id, prOf } from './release'

/**
 * Merges the base into the open factory MR of a Ticket waiting in review, as the factory bot and in every Run mode.
 * Clean: pushes (a no-op merge is counted per head in `mainMergeNoops`), then the verdict follows the Ticket diff (same patch-id keeps it, a changed one starts a Review Run). Real conflict: back to Build. Any other failure needs a human.
 */
export const mergeMainIntoMr = async (payload: Payload, ticketId: number, reviewedSha: string | null): Promise<void> => {
  const o = { overrideAccess: true, depth: 0 } as const
  const t = await payload.findByID({ collection: 'tickets', id: ticketId, ...o })
  if (t.stage !== 'review' || t.state !== 'open' || t.reviewState !== 'waiting_checks') return
  const mr = await prOf(payload, t)
  if (mr?.pr.state !== 'open') return
  const base = mr.pr.base
  try {
    const src = (await payload.find({ collection: 'ticket_sources', where: { product: { equals: id(t.product) } }, limit: 1, ...o })).docs[0]!
    const { gitToken, gitBaseUrl, gitUser } = gitAccess(await connectionInput(payload, src.connection))
    const attempt = async () => {
      const clone = await cloneRepo({ baseUrl: gitBaseUrl ?? 'https://github.com', repo: mr.repo, defaultBranch: base, token: gitToken, ...(gitUser && { user: gitUser }), branch: mr.pr.head, checkout: mr.pr.head })
      try {
        const head = await git(clone.dir, clone.env, 'rev-parse', 'HEAD')
        if ((await mergeBase(clone, clone.env, base)) === 'conflict') return null
        const pushed = await commitAndPush(clone, clone.env, `bauherr: merge ${base}`)
        return { pushed, patchId: await patchId(clone, clone.env, base), ...(head === reviewedSha && { reviewedPatchId: await patchId(clone, clone.env, base, head) }), pushedSha: await git(clone.dir, clone.env, 'rev-parse', 'HEAD') }
      } finally {
        await clone.cleanup()
      }
    }
    const merged = await attempt().catch(attempt)
    const same = t.mainMergeSha === mr.pr.headSha
    const counter = !merged ? {} : merged.pushed ? { mainMergeSha: null, mainMergeNoops: 0 } : { mainMergeSha: mr.pr.headSha, mainMergeNoops: same ? (t.mainMergeNoops ?? 0) + 1 : 1 }
    const marked = await payload.update({ collection: 'tickets', id: t.id, data: counter, ...o })
    if (!merged) await returnConflictToBuild(payload, marked, mr, reviewedSha)
    else if (!(await rebindReview(payload, marked, merged))) {
      await payload.update({ collection: 'tickets', id: t.id, data: { reviewState: null }, ...o })
      await (await import('../jobs')).startReviewIfReady(payload, { ...marked, reviewState: null })
    }
  } catch (e) {
    payload.logger.error({ err: e, ticket: t.id }, 'merging the base into the MR failed')
    await escalate(payload, t, `merging \`${base}\` into the MR failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
