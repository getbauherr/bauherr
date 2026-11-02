import { mergeChecks } from '../../../lib/release'
import { backendFor } from '../../../lib/adapters'
import { connectionInput } from '../../../lib/connection'
import { documents, readDocument, search, type Citation } from '../../../lib/knowledge'
import { within } from './overview'
import { renderMarkdown } from './markdown'
import { payloadClient } from './session'

export type KnowledgeDoc = { source: string; path: string }
export type WriteBack = { number: number; title: string; url: string; head: string; checks: 'green' | 'pending' | 'red'; failed: string[] }
export type KnowledgePage = {
  sources: { name: string; docs: KnowledgeDoc[] }[]
  repo: string | null
  hits: Citation[] | null
  doc: (KnowledgeDoc & { html: string; commit: string }) | null
  writeBacks: WriteBack[] | null
}

const FORGE_TIMEOUT_MS = 3000
export const docKey = (d: KnowledgeDoc) => `${d.source}:${d.path}`
/** `?doc=` is `<source>:<path>`; a source never contains a colon. */
export const parseDocKey = (key: string | undefined): KnowledgeDoc | null => {
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

/** Everything the Knowledge page shows for a Workspace: sources and documents, search hits for `q`, the rendered `doc`, and the open write-back PRs. */
export const loadKnowledge = async (workspace: number, q: string | undefined, docParam: string | undefined): Promise<KnowledgePage> => {
  const payload = await payloadClient()
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, overrideAccess: true })) as Record<string, any>
  const repo: string | null = ws.knowledgeRepo && ws.knowledgeConnection ? ws.knowledgeRepo : null
  const docs = await documents(payload, workspace)
  const sources: KnowledgePage['sources'] = []
  for (const { source, path } of docs) {
    const s = sources.at(-1)?.name === source ? sources.at(-1)! : sources[sources.push({ name: source, docs: [] }) - 1]!
    s.docs.push({ source, path })
  }
  const hits = q?.trim() ? await search(payload, workspace, q.trim()) : null
  const key = parseDocKey(docParam)
  const found = key ? docs.find((d) => d.source === key.source && d.path === key.path) : null
  const text = found ? await readDocument(payload, workspace, found.source, found.path) : null
  const doc = found && text !== null ? { source: found.source, path: found.path, commit: found.commit, html: renderMarkdown(text) } : null
  const writeBacks = repo ? await loadWriteBacks(payload, ws.knowledgeConnection, repo) : []
  return { sources, repo, hits, doc, writeBacks }
}
