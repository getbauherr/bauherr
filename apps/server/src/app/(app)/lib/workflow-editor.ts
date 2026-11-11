import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import { activeVersion, defaultHash, exportFactory, packSource } from '../../../lib/factory'
import { PRESET_TEXT, PRESETS, presetSource } from '../../../lib/presets'
import { corePack, packDir } from '../../../lib/workflow'
import { foldWip } from '../../../lib/workflow-edit'
import { payloadClient } from './session'

export type VersionRow = { version: number; at: string; by: string | null; via: string | null; note: string | null; /** Null for a version the seed wrote without a file. */ source: string | null }
export type EditorData = {
  slug: string
  /** The Workspace's factory file with the old WIP overrides folded into the stages. */
  base: string
  baseVersion: number | null
  /** `shipped`: the version is the file Bauherr ships. */
  active: { version: number; at: string; by: string | null; via: string | null; shipped: boolean } | null
  versions: VersionRow[]
  shipped: string
  presets: { id: string; title: string; blurb: string; source: string }[]
  /** Open Tickets per stage name. */
  counts: Record<string, number>
  skills: string[]
  /** Path sets (`touches` of a conditional step) that Products of the Workspace declare with paths, by set name: the Products' names. */
  pathSets: Record<string, string[]>
  expediteLane: boolean
}

const MAX_VERSIONS = 50

/** The path sets that have paths, by name, with the names of the Products that declare them. */
const declaredSets = (products: { name: string; pathSets?: Record<string, string[]> | null }[]): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  for (const p of products) for (const [n, g] of Object.entries(p.pathSets ?? {})) if (g.length) (out[n] ??= []).push(p.name)
  return out
}

/** Skills a step may use: directories of `skills/` in the pack dir and the core pack that hold a SKILL.md. */
const skillsOfPack = (): string[] =>
  [...new Set([packDir(), corePack()].flatMap((d) => (existsSync(resolve(d, 'skills')) ? readdirSync(resolve(d, 'skills')) : []).filter((n) => existsSync(resolve(d, 'skills', n, 'SKILL.md')))))].sort()

/** Everything the workflow editor page shows, from the database and the pack files only. */
export async function loadEditor(workspace: { id: number; slug: string }): Promise<EditorData> {
  const payload = await payloadClient()
  const db = payload.db.drizzle
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspace.id, select: { wipLimits: true, expediteLane: true }, depth: 0, overrideAccess: true })) as { wipLimits?: Record<string, number> | null; expediteLane?: boolean }
  const [active, source, versions, counts] = await Promise.all([
    activeVersion(payload, workspace.id),
    exportFactory(payload, workspace.id),
    db.execute(sql`SELECT "version", "created_at" AS at, "applied_by" AS by, "applied_via" AS via, "note", "source" FROM "workflow_versions" WHERE "workspace_id" = ${workspace.id} ORDER BY "version" DESC LIMIT ${MAX_VERSIONS}`),
    db.execute(sql`SELECT "stage", count(*) AS n FROM "tickets" WHERE "workspace_id" = ${workspace.id} AND "state" = 'open' GROUP BY "stage"`),
  ])
  return {
    slug: workspace.slug,
    base: foldWip(source, ws.wipLimits),
    baseVersion: active?.version ?? null,
    active: active && { version: active.version, at: active.at, by: active.by, via: active.via, shipped: active.hash === defaultHash() },
    versions: (versions.rows as Record<string, any>[]).map((r) => ({ version: Number(r.version), at: new Date(r.at).toISOString(), by: r.by ?? null, via: r.via ?? null, note: r.note ?? null, source: r.source ?? null })),
    shipped: packSource(),
    presets: PRESETS.map((id) => ({ id, ...PRESET_TEXT[id], source: presetSource(id) })),
    counts: Object.fromEntries((counts.rows as { stage: string; n: string }[]).map((r) => [r.stage, Number(r.n)])),
    skills: skillsOfPack(),
    pathSets: declaredSets((await payload.find({ collection: 'products', where: { workspace: { equals: workspace.id } }, select: { name: true, pathSets: true }, pagination: false, depth: 0, overrideAccess: true })).docs as unknown as { name: string; pathSets?: Record<string, string[]> | null }[]),
    expediteLane: ws.expediteLane !== false,
  }
}
