import { mergeChecks } from '../../../lib/release'
import { backendFor } from '../../../lib/adapters'
import { connectionInput } from '../../../lib/connection'
import { documents, readDocument, search, type Citation } from '../../../lib/knowledge'
import { within } from './overview'
import { renderMarkdown } from './markdown'
import { payloadClient } from './session'

export type KnowledgeDoc = { source: string; path: string; title: string }
export type WriteBack = { number: number; title: string; url: string; head: string; checks: 'green' | 'pending' | 'red'; failed: string[] }
export type SkillProposalRow = { id: number; ticket: string; status: string; skill: string; score: number | null; baseline: number | null; prUrl: string | null; prNumber: number | null; headSha: string | null; reason: string | null; results: ProposalResults | null }
/** Pass or fail per eval case without and with the skill, and what the replay cost. */
export type ProposalResults = { cases: { id: string; baseline: boolean | null; withSkill: boolean | null }[]; calls: number | null; cost: number | null }
export type KnowledgePage = {
  sources: { name: string; label: string; docs: KnowledgeDoc[] }[]
  repo: string | null
  hits: Citation[] | null
  doc: (KnowledgeDoc & { html: string }) | null
  /** Started with the load, not awaited: forge calls, so the page streams them in behind a Suspense boundary. */
  writeBacks: Promise<WriteBack[] | null>
  proposals: Promise<SkillProposalRow[]>
}

const FORGE_TIMEOUT_MS = 3000
/** Plain-language document title: its first heading, else the file name without `.md`, de-dashed and capitalised. */
export const title = (path: string, heading?: string | null): string => {
  if (heading?.trim()) return heading.trim()
  const name = (path.split('/').pop() ?? path).replace(/\.md$/, '').replace(/[-_]+/g, ' ').trim()
  return name.charAt(0).toUpperCase() + name.slice(1)
}
export const docKey = (d: { source: string; path: string }) => `${d.source}:${d.path}`
/** `?doc=` is `<source>:<path>`; a source never contains a colon. */
export const parseDocKey = (key: string | undefined): { source: string; path: string } | null => {
  const i = key?.indexOf(':') ?? -1
  return key && i > 0 && i < key.length - 1 ? { source: key.slice(0, i), path: key.slice(i + 1) } : null
}

/** Open `bauherr/*` PRs (write-backs and editor PRs) of the Knowledge repo with their merge-gate checks; null when the forge does not answer in time. */
const loadWriteBacks = async (payload: Awaited<ReturnType<typeof payloadClient>>, connection: unknown, repo: string): Promise<WriteBack[] | null> => {
  try {
    const forge = backendFor(await connectionInput(payload, connection)).forge
    return await within(
      (async () => {
        const prs = (await forge.listPullRequests(repo, 'open')).filter((p) => p.head.startsWith('bauherr/'))
        return Promise.all(
          prs.map(async (p) => {
            const { state, failed } = mergeChecks(await forge.listChecks(repo, p.headSha))
            return { number: p.number, title: p.title, url: p.url, head: p.head, checks: state, failed }
          }),
        )
      })(),
      FORGE_TIMEOUT_MS,
    )
  } catch {
    return null
  }
}

/** Distilled skill proposals of the Workspace, newest first; the head of an open PR is read from the forge (null when it does not answer) so the approval can name the head it saw. */
/** The replay results the distill job stored (`results`), reduced to what the Knowledge page shows; null when there are none. */
export const resultsOf = (r: unknown): ProposalResults | null => {
  const v = r as { baseline?: { id: string; pass: boolean }[]; withSkill?: { id: string; pass: boolean }[]; calls?: number; cost?: number } | null
  if (!v || (!Array.isArray(v.withSkill) && !Array.isArray(v.baseline))) return null
  const ids = [...new Set([...(v.withSkill ?? []), ...(v.baseline ?? [])].map((x) => x.id))]
  const pass = (rows: { id: string; pass: boolean }[] | undefined, id: string) => rows?.find((x) => x.id === id)?.pass ?? null
  return { cases: ids.map((id) => ({ id, baseline: pass(v.baseline, id), withSkill: pass(v.withSkill, id) })), calls: v.calls ?? null, cost: v.cost ?? null }
}

const loadProposals = async (payload: Awaited<ReturnType<typeof payloadClient>>, workspace: number, connection: unknown, repo: string): Promise<SkillProposalRow[]> => {
  const docs = (await payload.find({ collection: 'skill_proposals', where: { and: [{ workspace: { equals: workspace } }, { status: { in: ['proposed', 'replayed', 'accepted', 'rejected', 'skipped'] } }] }, sort: '-createdAt', limit: 20, depth: 1, overrideAccess: true })).docs as Record<string, any>[]
  const forge = backendFor(await connectionInput(payload, connection)).forge
  return Promise.all(
    docs.map(async (d) => {
      const pr = d.pr != null && ['proposed', 'replayed'].includes(d.status) ? await within(forge.getPullRequest(repo, Number(d.pr)), FORGE_TIMEOUT_MS).catch(() => null) : null
      return {
        id: d.id,
        ticket: `#${d.ticket?.number ?? ''} ${d.ticket?.title ?? ''}`.trim(),
        status: d.status,
        skill: String(d.skillPath ?? '').replace(/^workspace\/skills\/|\/SKILL\.md$/g, ''),
        score: d.score ?? null,
        baseline: d.baselineScore ?? null,
        prUrl: pr?.state === 'open' ? pr.url : null,
        prNumber: d.pr ?? null,
        headSha: pr?.state === 'open' ? pr.headSha : null,
        reason: d.reason ?? null,
        results: resultsOf(d.results),
      }
    }),
  )
}

/** Everything the Knowledge page shows for a Workspace: sources and documents, search hits for `q`, the rendered `doc`, and the open write-back PRs. */
export const loadKnowledge = async (workspace: number, q: string | undefined, docParam: string | undefined, { admin }: { admin: boolean }): Promise<KnowledgePage> => {
  const payload = await payloadClient()
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, overrideAccess: true })) as Record<string, any>
  const repo: string | null = ws.knowledgeRepo && ws.knowledgeConnection ? ws.knowledgeRepo : null
  const docs = (await documents(payload, workspace)).filter((d) => admin || d.source !== 'core')
  const productNames = new Map((await payload.find({ collection: 'products', where: { workspace: { equals: workspace } }, pagination: false, depth: 0, select: { name: true }, overrideAccess: true })).docs.map((p) => [String(p.id), p.name as string]))
  const label = (source: string) => (source === 'core' ? 'Built-in' : (source.includes('#') && productNames.get(source.split('#')[1]!)) || 'Your Knowledge')
  const sources: KnowledgePage['sources'] = []
  for (const { source, path, heading } of docs) {
    const s = sources.at(-1)?.name === source ? sources.at(-1)! : sources[sources.push({ name: source, label: label(source), docs: [] }) - 1]!
    s.docs.push({ source, path, title: title(path, heading) })
  }
  const hits = q?.trim() ? await search(payload, workspace, q.trim(), 20, undefined, !admin) : null
  const key = parseDocKey(docParam)
  const found = key ? docs.find((d) => d.source === key.source && d.path === key.path) : null
  const text = found ? await readDocument(payload, workspace, found.source, found.path) : null
  const doc = found && text !== null ? { source: found.source, path: found.path, title: title(found.path, found.heading), html: renderMarkdown(text) } : null
  const writeBacks = admin && repo ? loadWriteBacks(payload, ws.knowledgeConnection, repo) : Promise.resolve(admin ? [] : null)
  const proposals = admin && repo ? loadProposals(payload, workspace, ws.knowledgeConnection, repo).catch(() => []) : Promise.resolve([])
  return { sources, repo, hits, doc, writeBacks, proposals }
}
