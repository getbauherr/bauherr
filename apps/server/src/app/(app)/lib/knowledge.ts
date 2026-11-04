import { mergeChecks } from '../../../lib/release'
import { backendFor } from '../../../lib/adapters'
import { connectionInput } from '../../../lib/connection'
import { documents, readDocument, search, type Citation } from '../../../lib/knowledge'
import { within } from './overview'
import { renderMarkdown } from './markdown'
import { payloadClient } from './session'

export type KnowledgeDoc = { source: string; path: string; title: string }
export type WriteBack = { number: number; title: string; url: string; head: string; checks: 'green' | 'pending' | 'red'; failed: string[] }
export type KnowledgePage = {
  sources: { name: string; label: string; docs: KnowledgeDoc[] }[]
  repo: string | null
  hits: Citation[] | null
  doc: (KnowledgeDoc & { html: string }) | null
  writeBacks: WriteBack[] | null
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
  const writeBacks = admin && repo ? await loadWriteBacks(payload, ws.knowledgeConnection, repo) : admin ? [] : null
  return { sources, repo, hits, doc, writeBacks }
}
