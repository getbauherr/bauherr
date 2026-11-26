import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { loadLastCheck, type LastCheck } from '../readiness/last-check'
import { highestVersion, isRelease } from '../readiness/release-facts'
import { mergedTickets, type MergedTicket } from './merged'
import { readNotes, UNRELEASED, type StoredNotes } from './notes-store'
import { unfinishedVersions } from './run-store'
import { releaseStateSchema, type ReleaseState } from './state'

export type PastVersion = {
  tag: string
  at: string | null
  changes: number
  notes: string | null
  url: string | null
}

export type ReleasesView = {
  products: { id: number; name: string }[]
  product: { id: number; name: string } | null
  production: { sha: string; tag: string | null; at: string | null; url: string | null } | null
  staging: ReleaseState['staging']
  ready: { since: string | null; tickets: MergedTicket[]; visible: number } | null
  past: PastVersion[]
  notes: StoredNotes | null
  check: LastCheck | null
}

const productRow = z.object({ id: z.coerce.number(), name: z.string() })
const sourceRow = z.object({
  id: z.coerce.number(),
  release_state: releaseStateSchema.nullable(),
  facts_at: z.coerce.date().nullable(),
})

const timeOf = (iso: string | null): number => (iso === null ? Number.NEGATIVE_INFINITY : Date.parse(iso))

export const partition = (state: ReleaseState, merged: MergedTicket[], unfinished: string[] = []) => {
  const releases = state.versions.filter((version) => isRelease(version.tag) && !unfinished.includes(version.tag))
  const last = highestVersion(releases.map((version) => version.tag))
  const lastAt = releases.find((version) => version.tag === last)?.at ?? null
  const ascending = [...releases].sort((a, b) => timeOf(a.at) - timeOf(b.at))
  const past = ascending.map((version, index): PastVersion => {
    const from = timeOf(index === 0 ? state.olderAt : (ascending[index - 1]?.at ?? null))
    const to = timeOf(version.at)
    return {
      tag: version.tag,
      at: version.at,
      changes: merged.filter((t) => Date.parse(t.mergedAt) > from && Date.parse(t.mergedAt) <= to).length,
      notes: version.notes.trim() === '' ? null : version.notes,
      url: version.url,
    }
  })
  const tickets = merged.filter((ticket) => Date.parse(ticket.mergedAt) > timeOf(lastAt))
  return {
    ready: { since: last, tickets, visible: tickets.filter((ticket) => ticket.visible).length },
    past: past.reverse(),
  }
}

const productsOf = async (payload: Payload, workspace: number) => {
  const found = await payload.db.drizzle.execute(
    sql`SELECT "id", "name" FROM "products" WHERE "workspace_id" = ${workspace} ORDER BY "name", "id"`,
  )
  return found.rows.map((entry) => productRow.parse(entry))
}

export const sourceOf = async (payload: Payload, workspace: number, product: number) => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id", "release_state", "facts_at" FROM "ticket_sources"
    WHERE "product_id" = ${product} AND "workspace_id" = ${workspace} ORDER BY "id" LIMIT 1`)
  return found.rows[0] ? sourceRow.parse(found.rows[0]) : null
}

const productionOf = (state: ReleaseState): ReleasesView['production'] => {
  if (!state.production) return null
  const tagged = state.versions.find((version) => version.tag === state.production?.tag)
  return { ...state.production, at: tagged?.at ?? null, url: tagged?.url ?? null }
}

const checkOf = async (payload: Payload, source: z.output<typeof sourceRow>): Promise<LastCheck | null> => {
  const stored = await loadLastCheck(payload, source.id)
  const factsAt = source.facts_at?.toISOString()
  return stored ?? (factsAt ? { at: factsAt, error: null } : null)
}

export const releasesPage = async (
  payload: Payload,
  f: { workspace: number; product?: number | undefined },
): Promise<ReleasesView> => {
  const products = await productsOf(payload, f.workspace)
  const product = products.find((entry) => entry.id === f.product) ?? products[0] ?? null
  const none = { products, product, production: null, staging: null, ready: null, past: [], notes: null, check: null }
  const source = product ? await sourceOf(payload, f.workspace, product.id) : null
  const state = source?.release_state
  if (!product || !source) return none
  const check = await checkOf(payload, source)
  if (!state) return { ...none, check }
  const unfinished = await unfinishedVersions(payload, product.id)
  const { ready, past } = partition(state, await mergedTickets(payload, source.id), unfinished)
  const notes = await readNotes(payload, product.id, UNRELEASED)
  return { products, product, production: productionOf(state), staging: state.staging, ready, past, notes, check }
}
