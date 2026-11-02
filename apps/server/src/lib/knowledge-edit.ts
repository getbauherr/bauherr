import { Conflict, MergePendingError, type Forge, type PullRequest } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { backendFor } from './adapters'
import { connectionInput } from './connection'
import { resync } from './knowledge'
import { id, mergeChecks } from './release'

type Doc = Record<string, any>

/** Branch prefix of editor PRs; only PRs of this prefix in the Knowledge repo are merged by `watchKnowledgePrs`. */
export const EDIT_PREFIX = 'bauherr/edit-'
export const REBASED = '<!-- bauherr:rebased -->'
export const SUPERSEDED = '<!-- bauherr:superseded -->'
export const NEEDS_YOU = '<!-- bauherr:needs-you -->'
export const CHECKS_FAILED = '<!-- bauherr:checks-failed -->'

export class EditRefused extends Error {}

/** Unified-style line diff (`- old`, `+ new`, `  same`) of two texts. */
export const lineDiff = (a: string, b: string): string => {
  const x = a.split('\n')
  const y = b.split('\n')
  let head = 0
  while (head < x.length && head < y.length && x[head] === y[head]) head++
  let tail = 0
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++
  const p = x.slice(head, x.length - tail)
  const q = y.slice(head, y.length - tail)
  const lcs = Array.from({ length: p.length + 1 }, () => new Array<number>(q.length + 1).fill(0))
  for (let i = p.length - 1; i >= 0; i--) for (let j = q.length - 1; j >= 0; j--) lcs[i]![j] = p[i] === q[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const out = x.slice(0, head).map((l) => `  ${l}`)
  for (let i = 0, j = 0; i < p.length || j < q.length; ) {
    if (i < p.length && j < q.length && p[i] === q[j]) {
      out.push(`  ${p[i]}`)
      i++
      j++
    }
    else if (j >= q.length || (i < p.length && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) out.push(`- ${p[i++]}`)
    else out.push(`+ ${q[j++]}`)
  }
  return [...out, ...x.slice(x.length - tail).map((l) => `  ${l}`)].join('\n')
}

/** The Workspace's Knowledge repo and its forge, for a Bauherr who may see the Workspace; a document path must be a plain `.md` path inside that repo. */
const target = async (payload: Payload, user: Doc, workspace: number | string, path: string) => {
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, user: user as never, overrideAccess: false }).catch(() => null)) as Doc | null
  if (!ws) throw new EditRefused('Workspace not found.')
  if (!ws.knowledgeRepo || !ws.knowledgeConnection) throw new EditRefused('This Workspace has no Knowledge repo.')
  if (!/\.md$/.test(path) || path.startsWith('/') || path.split('/').some((s) => s === '..' || s === '')) throw new EditRefused('Only Markdown documents of the Knowledge repo can be edited.')
  const forge = backendFor(await connectionInput(payload, ws.knowledgeConnection)).forge
  return { ws, repo: ws.knowledgeRepo as string, forge }
}

/** Current text and blob sha of a document on the default branch; pass the sha back to `saveDocument` as `baseSha`. */
export const loadDocument = async (payload: Payload, user: Doc, workspace: number | string, path: string): Promise<{ content: string; sha: string }> => {
  const { repo, forge } = await target(payload, user, workspace, path)
  return forge.getFile(repo, path)
}

export type SaveResult = { pr: { number: number; url: string } } | { stale: { sha: string; diff: string } }

/** Saves `content` as a PR on the Knowledge repo (`bauherr/edit-<ts>`), merged later by `watchKnowledgePrs`. A document that changed since `baseSha` is not written; the result carries the diff from the current text to the submitted one and the current sha. */
export const saveDocument = async (payload: Payload, user: Doc, a: { workspace: number | string; path: string; content: string; baseSha: string }): Promise<SaveResult> => {
  const { ws, repo, forge } = await target(payload, user, a.workspace, a.path)
  const stale = async (): Promise<SaveResult> => {
    const current = await forge.getFile(repo, a.path)
    return { stale: { sha: current.sha, diff: lineDiff(current.content, a.content) } }
  }
  const current = await forge.getFile(repo, a.path)
  if (current.sha !== a.baseSha) return stale()
  if (current.content === a.content) throw new EditRefused('No changes to save.')
  const branch = `${EDIT_PREFIX}${Date.now()}`
  const trailer = `Co-authored-by: ${String(user.email).split('@')[0]} <${user.email}>`
  await forge.createBranch(repo, branch)
  try {
    await forge.putFile(repo, { branch, path: a.path, content: a.content, message: `Edit ${a.path}\n\n${trailer}`, expectSha: a.baseSha })
  } catch (e) {
    if (e instanceof Conflict) return stale()
    throw e
  }
  const pr = await forge.openPullRequest(repo, { title: `Edit ${a.path}`, body: `Edited in Bauherr by ${user.email}.\n\n${trailer}`, head: branch, base: (await forge.getRepository(repo)).defaultBranch })
  await payload.create({ collection: 'human_touches', data: { kind: 'knowledge-edit', actor: user.email, at: new Date().toISOString(), workspace: ws.id }, overrideAccess: true })
  return { pr: { number: pr.number, url: pr.url } }
}

/** Opens a fresh PR with the content of `pr`'s branch on the current default head; `pr` is closed after a marker comment. */
const recreate = async (forge: Forge, repo: string, pr: PullRequest): Promise<void> => {
  const files = await forge.listPullRequestFiles(repo, pr.number)
  if (files.length !== 1) throw new Error(`PR #${pr.number} changes ${files.length} files`)
  const path = files[0]!.filename
  const branch = `${EDIT_PREFIX}${Date.now()}`
  await forge.createBranch(repo, branch)
  await forge.putFile(repo, { branch, path, content: (await forge.getFile(repo, path, pr.head)).content, message: `Edit ${path}\n\n${/Co-authored-by:.*/.exec(pr.body)?.[0] ?? ''}`.trim() })
  const next = await forge.openPullRequest(repo, { title: pr.title, body: `${pr.body}\n\n${REBASED}\nSupersedes #${pr.number}.`, head: branch, base: pr.base })
  await forge.commentOnPullRequest(repo, pr.number, `${SUPERSEDED}\nRecreated as #${next.number} on the current head.`)
  await forge.closePullRequest(repo, pr.number)
}

/** Merges open editor PRs of every Workspace's Knowledge repo once their checks are green. Red checks: one comment, no merge. A PR that cannot merge is recreated once on the current head; the recreated PR failing again is flagged `needs-you`. Returns the number of merged PRs. */
export const watchKnowledgePrs = async (payload: Payload, now = Date.now()): Promise<number> => {
  let merged = 0
  const workspaces = (await payload.find({ collection: 'workspaces', where: { knowledgeRepo: { exists: true } }, limit: 1000, pagination: false, depth: 0, overrideAccess: true })).docs as Doc[]
  for (const ws of workspaces.filter((w) => w.knowledgeRepo && w.knowledgeConnection)) {
    const repo = ws.knowledgeRepo as string
    try {
      const forge = backendFor(await connectionInput(payload, id(ws.knowledgeConnection))).forge
      let mergedHere = false
      for (const pr of (await forge.listPullRequests(repo, 'open')).filter((p) => p.head.startsWith(EDIT_PREFIX) && p.headRepo.toLowerCase() === repo.toLowerCase() && p.baseRepo.toLowerCase() === repo.toLowerCase())) {
        try {
          const comments = await forge.listPullRequestComments(repo, pr.number)
          const marked = (m: string) => comments.some((c) => c.body.startsWith(m))
          if (marked(NEEDS_YOU) || marked(SUPERSEDED)) continue
          const list = await forge.listChecks(repo, pr.headSha)
          const checks = mergeChecks(list, list.length ? Infinity : now - Date.parse(await forge.getCommitDate(repo, pr.headSha)))
          if (checks.state === 'red') {
            if (!marked(CHECKS_FAILED)) await forge.commentOnPullRequest(repo, pr.number, `${CHECKS_FAILED}\nChecks failed: ${checks.failed.join(', ')}. Not merged.`)
            continue
          }
          if (checks.state === 'pending') continue
          try {
            await forge.mergePullRequest(repo, pr.number, { method: 'squash', deleteBranch: true, expectSha: pr.headSha })
            merged++
            mergedHere = true
          } catch (e) {
            if (e instanceof MergePendingError) continue
            payload.logger.warn({ err: e, repo, pr: pr.number }, 'knowledge edit PR did not merge')
            if (pr.body.includes(REBASED)) await forge.commentOnPullRequest(repo, pr.number, `${NEEDS_YOU}\nThis edit conflicts with the repo again after one automatic retry. It needs a human.`)
            else await recreate(forge, repo, pr)
          }
        } catch (e) {
          payload.logger.error({ err: e, repo, pr: pr.number }, 'watch-knowledge-prs failed for PR')
        }
      }
      if (mergedHere) await resync(payload, ws.id)
    } catch (e) {
      payload.logger.error({ err: e, workspace: ws.id }, 'watch-knowledge-prs failed')
    }
  }
  return merged
}
