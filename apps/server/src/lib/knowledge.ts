import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { backendFor } from './adapters'
import { connectionInput } from './connection'

type Doc = Record<string, any>
type Layer = 'core' | 'workspace' | 'product'

const PACK = () => resolve(process.env.BAUHERR_PACK_DIR ?? resolve(process.cwd(), '../../pack'))
const CHUNK_CHARS = 3200
const id = (v: unknown): number => Number(v && typeof v === 'object' ? (v as { id: number }).id : v)

/** One hit of a search: where the text lives and the commit it was indexed at. */
export interface Citation { source: string; path: string; heading: string; commit: string; text: string }

/** Splits a document into chunks of whole lines at headings (markdown only) and at ~800 tokens; concatenated they reproduce the document. */
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

/** Where a path of a source sits in the resolution order core -> workspace -> product; `logical` is the path without the layer prefix. */
export const layerOf = (path: string, core = false): { layer: Layer; logical: string; product: string | null } => {
  if (core) return { layer: 'core', logical: path, product: null }
  const p = /^products\/([^/]+)\/(.+)$/.exec(path)
  if (p) return { layer: 'product', logical: p[2]!, product: p[1]! }
  return { layer: 'workspace', logical: path.replace(/^workspace\//, ''), product: null }
}

const isMd = (path: string) => /\.md$/.test(path)

const packFiles = (): { path: string; text: string }[] => {
  const root = PACK()
  return (readdirSync(root, { recursive: true, withFileTypes: true }) as { name: string; parentPath: string; isFile(): boolean }[])
    .filter((e) => e.isFile() && /\.(md|ya?ml|ts|sh)$/.test(e.name))
    .map((e) => {
      const abs = resolve(e.parentPath, e.name)
      return { path: relative(root, abs).split(sep).join('/'), text: readFileSync(abs, 'utf8') }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

const replaceSource = async (payload: Payload, workspace: number, source: string, commit: string, files: { path: string; text: string }[], core: boolean) => {
  const rows = files.flatMap((f) =>
    chunk(f.text, isMd(f.path)).map((c) => {
      const l = layerOf(f.path, core)
      return sql`(${workspace}, ${source}, ${l.layer}, ${f.path}, ${l.logical}, ${l.product}, ${c.heading}, ${c.text}, ${commit}, now(), now())`
    }),
  )
  await payload.db.drizzle.transaction(async (tx: any) => {
    await tx.execute(sql`DELETE FROM "knowledge_chunks" WHERE "workspace_id" = ${workspace} AND "source" = ${source}`)
    for (let i = 0; i < rows.length; i += 200) {
      await tx.execute(sql`INSERT INTO "knowledge_chunks" ("workspace_id", "source", "layer", "path", "logical", "product", "heading", "text", "commit", "updated_at", "created_at") VALUES ${sql.join(rows.slice(i, i + 200), sql`, `)}`)
    }
  })
}

const BACKOFF_MS = 10 * 60_000
const save = async (payload: Payload, workspace: number, indexed: Record<string, string>): Promise<true> => {
  await payload.update({ collection: 'workspaces', id: workspace, data: { knowledgeIndexed: indexed }, overrideAccess: true })
  return true
}

/** Re-indexes the core pack (when its content changed) and the Knowledge repo (when its default-branch commit changed); a repo that fails keeps its old index and is not retried for 10 minutes; chunks of any other repo are dropped. Returns whether anything was indexed. */
export const resync = async (payload: Payload, workspaceId: number | string): Promise<boolean> => {
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspaceId, depth: 0, overrideAccess: true })) as Doc
  const indexed: Record<string, string> = { ...ws.knowledgeIndexed }
  let changed = false

  const pack = packFiles()
  const packKey = createHash('sha1').update(JSON.stringify(pack)).digest('hex')
  if (indexed.core !== packKey) {
    await replaceSource(payload, ws.id, 'core', 'core-pack', pack, true)
    indexed.core = packKey
    changed = true
  }

  await payload.db.drizzle.execute(sql`DELETE FROM "knowledge_chunks" WHERE "workspace_id" = ${ws.id} AND "source" NOT IN ('core', ${ws.knowledgeRepo ?? ''})`)

  const failedAt = indexed.gitFailed?.startsWith(`${ws.knowledgeRepo}|`) ? Date.parse(indexed.gitFailed.split('|')[1]!) : 0
  if (ws.knowledgeRepo && ws.knowledgeConnection) {
    if (Date.now() - failedAt < BACKOFF_MS) return changed && (await save(payload, ws.id, indexed))
    try {
      const forge = backendFor(await connectionInput(payload, ws.knowledgeConnection)).forge
      const { commit, paths, truncated } = await forge.listFiles(ws.knowledgeRepo)
      if (indexed.git !== `${ws.knowledgeRepo}@${commit}`) {
        if (truncated) payload.logger.warn({ workspace: ws.id, repo: ws.knowledgeRepo }, 'knowledge repo tree truncated by GitHub; indexing the files returned')
        const files: { path: string; text: string }[] = []
        for (const path of paths.filter(isMd)) files.push({ path, text: (await forge.getFile(ws.knowledgeRepo, path, commit)).content })
        await replaceSource(payload, ws.id, ws.knowledgeRepo, commit, files, false)
        indexed.git = `${ws.knowledgeRepo}@${commit}`
        changed = true
      }
      if (indexed.gitFailed) {
        delete indexed.gitFailed
        changed = true
      }
    } catch (e) {
      payload.logger.error({ err: e, workspace: ws.id }, 'knowledge resync failed')
      indexed.gitFailed = `${ws.knowledgeRepo}|${new Date().toISOString()}`
      await save(payload, ws.id, indexed)
    }
  } else if (indexed.git || indexed.gitFailed) {
    delete indexed.git
    delete indexed.gitFailed
    changed = true
  }

  return changed && (await save(payload, ws.id, indexed))
}

const indexedOnce = async (payload: Payload, workspace: number): Promise<void> => {
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, overrideAccess: true })) as Doc
  if (!ws.knowledgeIndexed?.core) await resync(payload, workspace)
}

const visible = (alias: string, product?: string) => sql`(${sql.raw(alias)}."layer" <> 'product' OR ${sql.raw(alias)}."product" = ${product ?? null})`
const rank = (alias: string) => sql.raw(`CASE ${alias}."layer" WHEN 'product' THEN 2 WHEN 'workspace' THEN 1 ELSE 0 END`)
const vector = sql`to_tsvector('simple', coalesce(c."heading", '') || ' ' || coalesce(c."text", ''))`

/** Full-text search over the Workspace's index. Layers resolve core -> workspace -> product (the reader's `product` slug); a document shadowed by a later layer at the same logical path is not returned. */
export const search = async (payload: Payload, workspace: number | string, q: string, limit = 20, product?: string): Promise<Citation[]> => {
  const ws = id(workspace)
  await indexedOnce(payload, ws)
  const r = await payload.db.drizzle.execute(sql`
    SELECT c."source", c."path", c."heading", c."commit", c."text"
    FROM "knowledge_chunks" c
    WHERE c."workspace_id" = ${ws} AND ${visible('c', product)}
      AND ${vector} @@ websearch_to_tsquery('simple', ${q})
      AND NOT EXISTS (
        SELECT 1 FROM "knowledge_chunks" o
        WHERE o."workspace_id" = c."workspace_id" AND o."logical" = c."logical" AND ${visible('o', product)} AND ${rank('o')} > ${rank('c')})
    ORDER BY ts_rank(${vector}, websearch_to_tsquery('simple', ${q})) DESC, c."path", c."id"
    LIMIT ${limit}`)
  return r.rows as unknown as Citation[]
}

/** A document by logical path (`rules/evidence.md`): the highest visible layer wins. Null when the index has none. */
export const read = async (payload: Payload, workspace: number | string, path: string, product?: string): Promise<{ source: string; text: string } | null> => {
  const ws = id(workspace)
  await indexedOnce(payload, ws)
  const r = await payload.db.drizzle.execute(sql`
    SELECT c."source", c."text" FROM "knowledge_chunks" c
    WHERE c."workspace_id" = ${ws} AND c."logical" = ${path} AND ${visible('c', product)}
      AND NOT EXISTS (
        SELECT 1 FROM "knowledge_chunks" o
        WHERE o."workspace_id" = c."workspace_id" AND o."logical" = c."logical" AND ${visible('o', product)} AND ${rank('o')} > ${rank('c')})
    ORDER BY c."id"`)
  return r.rows.length ? { source: (r.rows[0] as any).source, text: r.rows.map((x: any) => x.text).join('') } : null
}

/** Markdown documents of the Workspace's index, per source (core pack first), with the commit they were indexed at. */
export const documents = async (payload: Payload, workspace: number | string): Promise<{ source: string; path: string; commit: string }[]> => {
  const ws = id(workspace)
  await indexedOnce(payload, ws)
  const r = await payload.db.drizzle.execute(sql`
    SELECT "source", "path", min("commit") AS "commit" FROM "knowledge_chunks"
    WHERE "workspace_id" = ${ws} AND "path" LIKE '%.md'
    GROUP BY "source", "path"
    ORDER BY ("source" = 'core') DESC, "source", "path"`)
  return r.rows as unknown as { source: string; path: string; commit: string }[]
}

/** One document by its source and full path (no layer resolution); null when the index has none. */
export const readDocument = async (payload: Payload, workspace: number | string, source: string, path: string): Promise<string | null> => {
  const r = await payload.db.drizzle.execute(sql`
    SELECT "text" FROM "knowledge_chunks" WHERE "workspace_id" = ${id(workspace)} AND "source" = ${source} AND "path" = ${path} ORDER BY "id"`)
  return r.rows.length ? r.rows.map((x: any) => x.text).join('') : null
}
