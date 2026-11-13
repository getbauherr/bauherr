import { live } from './workspace-delete'
import { Conflict, MergePendingError, type Forge, type PullRequest } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { backendFor } from './adapters'
import { connectionInput } from './connection'
import { resync } from './knowledge'
import { id, mergeChecks } from './release'
import { personOf } from './person'

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

/** Line range of `b` that differs from `a` (common head and tail trimmed): `[from, toInA)` in `a` replaced by `lines`. */
const change = (a: string[], b: string[]) => {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  return { from: head, to: a.length - tail, lines: b.slice(head, b.length - tail) }
}

/** Three-way merge of the user's text and the current text against the text the edit started from. `null` when both changed the same or an adjacent region. */
export const merge3 = (base: string, mine: string, theirs: string): string | null => {
  if (mine === theirs || theirs === base) return mine
  if (mine === base) return theirs
  const b = base.split('\n')
  const m = change(b, mine.split('\n'))
  const t = change(b, theirs.split('\n'))
  if (m.to >= t.from && t.to >= m.from) return null
  const [first, second] = m.from < t.from ? [m, t] : [t, m]
  return [...b.slice(0, first.from), ...first.lines, ...b.slice(first.to, second.from), ...second.lines, ...b.slice(second.to)].join('\n')
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
  return forge.getFile(repo, path).catch(() => {
    throw new EditRefused('Document not found.')
  })
}

export type SaveResult = { pr: { number: number; url: string } } | { stale: { sha: string; diff: string } }

/** The factory-opened edit PR: only recorded PRs, at their recorded head, are ever merged. */
const record = (payload: Payload, a: { workspace: number | string; person: string; repo: string; path: string; pr: PullRequest; baseContent: string }) =>
  payload.create({
    collection: 'human_touches',
    data: { kind: 'knowledge-edit', actor: personOf({ email: a.person }), at: new Date().toISOString(), workspace: a.workspace, repo: a.repo, path: a.path, prNumber: a.pr.number, headSha: a.pr.headSha, baseContent: a.baseContent, status: 'open' },
    overrideAccess: true,
  } as never)

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
  await record(payload, { workspace: ws.id, person: personOf(user), repo, path: a.path, pr, baseContent: current.content })
  return { pr: { number: pr.number, url: pr.url } }
}

/** Re-applies the recorded edit of `pr` on the current default head (three-way against the text the edit started from) as a fresh PR; `pr` is closed after a marker comment. Returns the diff when the same region changed on the default branch: nothing is written then. */
const recreate = async (payload: Payload, forge: Forge, repo: string, pr: PullRequest, rec: Doc): Promise<{ conflict: string } | null> => {
  const path = rec.path as string
  const mine = (await forge.getFile(repo, path, pr.head)).content
  const current = await forge.getFile(repo, path, pr.base)
  const merged = merge3(rec.baseContent, mine, current.content)
  if (merged === null) return { conflict: lineDiff(current.content, mine) }
  const branch = `${EDIT_PREFIX}${Date.now()}`
  await forge.createBranch(repo, branch)
  await forge.putFile(repo, { branch, path, content: merged, message: `Edit ${path}\n\n${/Co-authored-by:.*/.exec(pr.body)?.[0] ?? ''}`.trim(), expectSha: current.sha })
  const next = await forge.openPullRequest(repo, { title: pr.title, body: `${pr.body}\n\n${REBASED}\nSupersedes #${pr.number}.`, head: branch, base: pr.base })
  await record(payload, { workspace: rec.workspace, person: rec.actor, repo, path, pr: next, baseContent: current.content })
  await forge.commentOnPullRequest(repo, pr.number, `${SUPERSEDED}\nRecreated as #${next.number} on the current head.`)
  await forge.closePullRequest(repo, pr.number)
  return null
}

/** Merges the open editor PRs the factory recorded (`saveDocument`, `recreate`) once their checks are green: same repo, still at the recorded head, exactly the one recorded `.md` file. Foreign `bauherr/edit-*` PRs are never touched. Red checks: one comment, no merge. A PR that cannot merge is re-applied once on the current head; if the same region changed there, or the recreated PR fails again, it is flagged `needs-you` with the diff. Returns the number of merged PRs. */
export const watchKnowledgePrs = async (payload: Payload, now = Date.now()): Promise<number> => {
  let merged = 0
  const workspaces = (await payload.find({ collection: 'workspaces', where: { and: [{ knowledgeRepo: { exists: true } }, live] }, limit: 1000, pagination: false, depth: 0, overrideAccess: true })).docs as Doc[]
  for (const ws of workspaces.filter((w) => w.knowledgeRepo && w.knowledgeConnection)) {
    const repo = ws.knowledgeRepo as string
    try {
      const open = (await payload.find({ collection: 'human_touches', where: { and: [{ kind: { equals: 'knowledge-edit' } }, { status: { equals: 'open' } }, { repo: { equals: repo } }, { workspace: { equals: ws.id } }] }, limit: 1000, pagination: false, depth: 0, overrideAccess: true })).docs as Doc[]
      if (!open.length) continue
      const forge = backendFor(await connectionInput(payload, id(ws.knowledgeConnection))).forge
      const done = (rec: Doc) => payload.update({ collection: 'human_touches', id: rec.id, data: { status: 'done' }, overrideAccess: true } as never)
      let mergedHere = false
      const prs = (await forge.listPullRequests(repo, 'open')).filter((p) => p.head.startsWith(EDIT_PREFIX))
      for (const rec of open) {
        const pr = prs.find((p) => p.number === rec.prNumber)
        try {
          if (!pr || pr.state !== 'open') {
            await done(rec)
            continue
          }
          if (!pr.head.startsWith(EDIT_PREFIX) || pr.headRepo.toLowerCase() !== repo.toLowerCase() || pr.baseRepo.toLowerCase() !== repo.toLowerCase() || pr.headSha !== rec.headSha) continue
          const files = await forge.listPullRequestFiles(repo, pr.number)
          if (files.length !== 1 || files[0]!.filename !== rec.path || !/\.md$/.test(rec.path)) continue
          const comments = await forge.listPullRequestComments(repo, pr.number)
          const marked = (m: string) => comments.some((c) => c.body.startsWith(m))
          if (marked(NEEDS_YOU) || marked(SUPERSEDED)) {
            await done(rec)
            continue
          }
          const list = await forge.listChecks(repo, pr.headSha)
          const checks = mergeChecks(list, list.length ? Infinity : now - Date.parse(await forge.getCommitDate(repo, pr.headSha)))
          if (checks.state === 'red') {
            if (!marked(CHECKS_FAILED)) await forge.commentOnPullRequest(repo, pr.number, `${CHECKS_FAILED}\nChecks failed: ${checks.failed.join(', ')}. Not merged.`)
            continue
          }
          if (checks.state === 'pending') continue
          try {
            await forge.mergePullRequest(repo, pr.number, { method: 'squash', deleteBranch: true, expectSha: pr.headSha })
            await done(rec)
            merged++
            mergedHere = true
          } catch (e) {
            if (e instanceof MergePendingError) continue
            payload.logger.warn({ err: e, repo, pr: pr.number }, 'knowledge edit PR did not merge')
            const flag = async (diff: string) => {
              await forge.commentOnPullRequest(repo, pr.number, `${NEEDS_YOU}\nThis edit conflicts with ${pr.base}. It needs a human; diff from ${pr.base} to the edit:\n\n\`\`\`diff\n${diff}\n\`\`\``)
              await done(rec)
            }
            if (pr.body.includes(REBASED)) await flag(lineDiff((await forge.getFile(repo, rec.path, pr.base)).content, (await forge.getFile(repo, rec.path, pr.head)).content))
            else {
              const r = await recreate(payload, forge, repo, pr, rec)
              if (r) await flag(r.conflict)
              else await done(rec)
            }
          }
        } catch (e) {
          payload.logger.error({ err: e, repo, pr: rec.prNumber }, 'watch-knowledge-prs failed for PR')
        }
      }
      if (mergedHere) await resync(payload, ws.id)
    } catch (e) {
      payload.logger.error({ err: e, workspace: ws.id }, 'watch-knowledge-prs failed')
    }
  }
  return merged
}
