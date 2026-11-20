import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { backendFor } from './adapters'
import { connectionInput } from './connection'

type WorkspaceDoc = {
  id: number
  knowledgeRepo?: string | null
  knowledgeConnection?: unknown
  knowledgeIndexed?: Record<string, string> | null
}
type LinkedDoc = { id: number; slug?: string; fullName?: string; product?: unknown; connection?: unknown }
type Layer = 'workspace' | 'product'

const CHUNK_CHARS = 3200
const id = (v: unknown): number => Number(v && typeof v === 'object' ? (v as { id: number }).id : v)

export type Citation = {
  source: string
  path: string
  heading: string
  commit: string
  text: string
}

export const chunk = (text: string, markdown = true): { heading: string; text: string }[] => {
  const out: { heading: string; text: string }[] = []
  let heading = ''
  let cur = ''
  let fence = false
  const flush = () => {
    if (cur.trim()) out.push({ heading, text: cur })
    cur = ''
  }
  for (const line of text.split(/(?<=\n)/)) {
    if (markdown && /^\s*(```|~~~)/.test(line)) fence = !fence
    const h = markdown && !fence ? /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line) : null
    if (h || cur.length + line.length > CHUNK_CHARS) flush()
    if (h) heading = h[1]!
    cur += line
  }
  flush()
  return out
}

export const layerOf = (
  path: string,
  repoProduct?: string,
): { layer: Layer; logical: string; product: string | null } => {
  if (repoProduct) return { layer: 'product', logical: `repo-docs/${path}`, product: repoProduct }
  const p = /^products\/([^/]+)\/(.+)$/.exec(path)
  if (p) return { layer: 'product', logical: p[2], product: p[1] }
  return { layer: 'workspace', logical: path.replace(/^workspace\//, ''), product: null }
}

export const repoOf = (source: string): string => source.split('#')[0]

const isMd = (path: string) => /\.md$/.test(path)

const replaceSource = async (
  payload: Payload,
  workspace: number,
  source: string,
  commit: string,
  files: { path: string; text: string }[],
  repoProduct?: string,
) => {
  const rows = files.flatMap((f) =>
    chunk(f.text, isMd(f.path)).map((c) => {
      const l = layerOf(f.path, repoProduct)
      return sql`(${workspace}, ${source}, ${l.layer}, ${f.path}, ${l.logical}, ${l.product},
        ${c.heading}, ${c.text}, ${commit}, now(), now())`
    }),
  )
  await payload.db.drizzle.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM "knowledge_chunks" WHERE "workspace_id" = ${workspace} AND "source" = ${source}`)
    for (let i = 0; i < rows.length; i += 200) {
      await tx.execute(
        sql`INSERT INTO "knowledge_chunks" ("workspace_id", "source", "layer", "path", "logical", "product",
          "heading", "text", "commit", "updated_at", "created_at")
          VALUES ${sql.join(rows.slice(i, i + 200), sql`, `)}`,
      )
    }
  })
}

const BACKOFF_MS = 10 * 60_000
const save = async (payload: Payload, workspace: number, indexed: Record<string, string>): Promise<true> => {
  await payload.update({
    collection: 'workspaces',
    id: workspace,
    data: { knowledgeIndexed: indexed },
    overrideAccess: true,
  })
  return true
}

const DOCS = /^(README\.md|docs\/.*\.md)$/

type Target = { key: string; source: string; repo: string; connection: unknown; slug: string }
type Sync = { payload: Payload; ws: WorkspaceDoc; indexed: Record<string, string>; changed: boolean }

const findInWorkspace = async (
  payload: Payload,
  collection: 'products' | 'repositories' | 'ticket_sources',
  workspace: number,
): Promise<LinkedDoc[]> =>
  (
    await payload.find({
      collection,
      where: { workspace: { equals: workspace } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    })
  ).docs as LinkedDoc[]

const firstByProduct = (docs: LinkedDoc[]): Map<number, LinkedDoc> => {
  const byProduct = new Map<number, LinkedDoc>()
  for (const d of [...docs].sort((a, b) => a.id - b.id))
    if (!byProduct.has(id(d.product))) byProduct.set(id(d.product), d)
  return byProduct
}

const productTargets = async (payload: Payload, ws: WorkspaceDoc): Promise<Target[]> => {
  const products = await findInWorkspace(payload, 'products', ws.id)
  const repos = firstByProduct(await findInWorkspace(payload, 'repositories', ws.id))
  const sources = firstByProduct(await findInWorkspace(payload, 'ticket_sources', ws.id))
  return products.flatMap((p) => {
    const repo = repos.get(p.id)?.fullName
    const connection = sources.get(p.id)?.connection
    return repo && connection && repo !== ws.knowledgeRepo
      ? [{ key: `product:${p.id}`, source: `${repo}#${p.id}`, repo, connection, slug: p.slug as string }]
      : []
  })
}

const dropStaleChunks = async (payload: Payload, ws: WorkspaceDoc, targets: Target[]): Promise<void> => {
  const keep = [ws.knowledgeRepo ?? '', ...targets.map((t) => t.source)]
  await payload.db.drizzle.execute(
    sql`DELETE FROM "knowledge_chunks" WHERE "workspace_id" = ${ws.id} AND "source" NOT IN (${sql.join(
      keep.map((k) => sql`${k}`),
      sql`, `,
    )})`,
  )
}

const dropStaleKeys = (state: Sync, targets: Target[]): void => {
  for (const k of Object.keys(state.indexed)) {
    if (k.startsWith('product:') && !targets.some((t) => k === t.key || k === `${t.key}:failed`)) {
      delete state.indexed[k]
      state.changed = true
    }
  }
}

const indexSource = async (
  state: Sync,
  forge: ReturnType<typeof backendFor>['forge'],
  target: { key: string; repo: string; source: string; slug?: string },
  pick: (path: string) => boolean,
): Promise<void> => {
  const { payload, ws, indexed } = state
  const { key, repo, source, slug } = target
  const { commit, paths, truncated } = await forge.listFiles(repo)
  if (indexed[key] === `${repo}@${commit}`) return
  if (truncated)
    payload.logger.warn({ workspace: ws.id, repo }, `${repo} tree truncated by GitHub; indexing the files returned`)
  const files: { path: string; text: string }[] = []
  for (const path of paths.filter(pick)) files.push({ path, text: (await forge.getFile(repo, path, commit)).content })
  await replaceSource(payload, ws.id, source, commit, files, slug)
  indexed[key] = `${repo}@${commit}`
  state.changed = true
}

const syncSource = async (
  state: Sync,
  target: { key: string; failKey: string; repo: string; source: string; connection: unknown; slug?: string },
  pick: (path: string) => boolean,
): Promise<void> => {
  const { payload, ws, indexed } = state
  const { key, failKey, repo, source, connection, slug } = target
  const failedAt = indexed[failKey]?.startsWith(`${repo}|`) ? Date.parse(indexed[failKey].split('|')[1]) : 0
  if (Date.now() - failedAt < BACKOFF_MS) return
  try {
    const forge = backendFor(await connectionInput(payload, connection)).forge
    await indexSource(state, forge, { key, repo, source, slug }, pick)
    if (indexed[failKey]) {
      delete indexed[failKey]
      state.changed = true
    }
  } catch (e) {
    payload.logger.error({ err: e, workspace: ws.id, repo }, 'knowledge resync failed')
    indexed[failKey] = `${repo}|${new Date().toISOString()}`
    await save(payload, ws.id, indexed)
  }
}

const syncWorkspaceRepo = async (state: Sync): Promise<void> => {
  const { ws, indexed } = state
  if (ws.knowledgeRepo && ws.knowledgeConnection) {
    const repo = ws.knowledgeRepo
    const target = { key: 'git', failKey: 'gitFailed', repo, source: repo, connection: ws.knowledgeConnection }
    await syncSource(state, target, isMd)
  } else if (indexed.git || indexed.gitFailed) {
    delete indexed.git
    delete indexed.gitFailed
    state.changed = true
  }
}

export const resync = async (payload: Payload, workspaceId: number | string): Promise<boolean> => {
  const ws = (await payload.findByID({
    collection: 'workspaces',
    id: workspaceId,
    depth: 0,
    overrideAccess: true,
  })) as WorkspaceDoc
  const state: Sync = { payload, ws, indexed: { ...ws.knowledgeIndexed }, changed: false }
  const targets = await productTargets(payload, ws)
  await dropStaleChunks(payload, ws, targets)
  dropStaleKeys(state, targets)
  await syncWorkspaceRepo(state)
  for (const t of targets) await syncSource(state, { ...t, failKey: `${t.key}:failed` }, (path) => DOCS.test(path))
  return state.changed && (await save(payload, ws.id, state.indexed))
}

const indexedOnce = async (payload: Payload, workspace: number): Promise<void> => {
  const ws = (await payload.findByID({
    collection: 'workspaces',
    id: workspace,
    depth: 0,
    overrideAccess: true,
  })) as WorkspaceDoc
  if (!ws.knowledgeIndexed) await resync(payload, workspace)
}

const visible = (alias: string, product?: string) =>
  sql`(${sql.raw(alias)}."layer" <> 'product' OR ${sql.raw(alias)}."product" = ${product ?? null})`
const rank = (alias: string) => sql.raw(`CASE ${alias}."layer" WHEN 'product' THEN 2 ELSE 1 END`)
const vector = sql`to_tsvector('simple', coalesce(c."heading", '') || ' ' || coalesce(c."text", ''))`

export const search = async (
  payload: Payload,
  workspace: number | string,
  q: string,
  limit = 20,
  product?: string,
): Promise<Citation[]> => {
  const ws = id(workspace)
  await indexedOnce(payload, ws)
  const r = await payload.db.drizzle.execute<Citation>(sql`
    SELECT c."source", c."path", c."heading", c."commit", c."text"
    FROM "knowledge_chunks" c
    WHERE c."workspace_id" = ${ws} AND ${visible('c', product)}
      AND ${vector} @@ websearch_to_tsquery('simple', ${q})
      AND NOT EXISTS (
        SELECT 1 FROM "knowledge_chunks" o
        WHERE o."workspace_id" = c."workspace_id" AND o."logical" = c."logical"
          AND ${visible('o', product)} AND ${rank('o')} > ${rank('c')})
    ORDER BY ts_rank(${vector}, websearch_to_tsquery('simple', ${q})) DESC, c."path", c."id"
    LIMIT ${limit}`)
  return r.rows
}
