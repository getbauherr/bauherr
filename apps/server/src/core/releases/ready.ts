import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { evaluate } from '../readiness/checks'
import { loadFacts } from '../readiness/load'
import { releaseStateOf } from '../readiness/view'
import { mergedTickets, type MergedTicket } from './merged'
import { doneRuns, openRun, unfinishedVersions, usedVersions } from './run-store'
import { bumpOf, nextVersion, type Bump, type ChangeFacts } from './version'
import { partition, sourceOf } from './view'

export type ProductAt = { workspace: number; product: number }

const changeRow = z.object({ id: z.coerce.number(), data: z.unknown() })
const changeData = z
  .looseObject({
    type: z.string().optional(),
    result: z.looseObject({ changes: z.array(z.looseObject({ tag: z.string() })) }).nullish(),
  })
  .transform((data) => {
    const changes = data.result?.changes ?? []
    return { bug: data.type === 'bug', tags: changes.map((change) => change.tag) }
  })
  .catch({ bug: false, tags: [] })

const changeFactsOf = async (payload: Payload, tickets: MergedTicket[]): Promise<ChangeFacts[]> => {
  if (tickets.length === 0) return []
  const ids = tickets.map((ticket) => sql`${ticket.recordId}`)
  const found = await payload.db.drizzle.execute(
    sql`SELECT "id", "data" FROM "records" WHERE "id" IN (${sql.join(ids, sql`, `)})`,
  )
  const rows = new Map(found.rows.map((entry) => changeRow.parse(entry)).map((row) => [row.id, row.data]))
  return tickets.map((ticket) => ({ ...changeData.parse(rows.get(ticket.recordId)), breaking: ticket.breaking }))
}

export type ReleaseReady = {
  sha: string
  tags: string[]
  tickets: { recordId: number; number: number }[]
  merged: MergedTicket[]
  since: string | null
  proposal: { version: string | null; bump: Bump }
  refusal: string | null
}

const refusalOf = async (payload: Payload, f: ProductAt, now: Date, ticketCount: number, sha: string | null) => {
  const loaded = await loadFacts(payload, { ...f, now })
  if (!loaded) return 'This product is not found.'
  const state = releaseStateOf(loaded.facts.releaseMode, evaluate(loaded.facts))
  if (state.mode === 'direct') return 'This product releases without the factory.'
  if (state.blocked) return 'The repository has release gaps. Fix them in the product settings first.'
  if (ticketCount === 0) return 'Nothing was merged since the last version.'
  if (sha === null) return 'Staging reports no deployment, so there is no build to release.'
  return null
}

export const readyToRelease = async (payload: Payload, f: ProductAt, now: Date): Promise<ReleaseReady | null> => {
  const source = await sourceOf(payload, f.workspace, f.product)
  if (!source?.release_state) return null
  const state = source.release_state
  const unfinished = await unfinishedVersions(payload, f.product)
  const { ready } = partition(state, await mergedTickets(payload, source.id), unfinished)
  const finished = (await doneRuns(payload, f.product)).filter(
    (run) => !state.versions.some((version) => version.tag === run.version),
  )
  const released = new Set(finished.flatMap((run) => run.tickets.map((ticket) => ticket.recordId)))
  const kept = state.versions.map((version) => version.tag).filter((tag) => !unfinished.includes(tag))
  const tags = [...kept, ...finished.map((run) => run.version)]
  const used = await usedVersions(payload, f.product)
  const merged = ready.tickets.filter((ticket) => !released.has(ticket.recordId))
  const bump = bumpOf(await changeFactsOf(payload, merged))
  const sha = state.staging?.sha ?? null
  const open = await openRun(payload, f.product)
  const refusal = open
    ? `Releasing ${open.version} is not finished yet.`
    : await refusalOf(payload, f, now, merged.length, sha)
  return {
    sha: sha ?? '',
    tags: [...new Set([...tags, ...state.versions.map((version) => version.tag), ...used])],
    tickets: merged.map(({ recordId, number }) => ({ recordId, number })),
    merged,
    since: ready.since,
    proposal: { version: nextVersion(tags, bump, used), bump },
    refusal,
  }
}

