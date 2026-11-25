import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { evaluate } from '../readiness/checks'
import { loadFacts } from '../readiness/load'
import { releaseStateOf } from '../readiness/view'
import { mergedTickets } from './merged'
import { doneRuns, openRun } from './run-store'
import { bumpOf, nextVersion, type Bump, type ChangeFacts } from './version'
import { partition, sourceOf } from './view'

export type ProductAt = { workspace: number; product: number }

const changeRow = z.object({ data: z.unknown() })
const changeData = z
  .looseObject({
    type: z.string().optional(),
    result: z.looseObject({ changes: z.array(z.looseObject({ tag: z.string() })) }).nullish(),
  })
  .transform((data): ChangeFacts => {
    const changes = data.result?.changes ?? []
    return { bug: data.type === 'bug', tags: changes.map((change) => change.tag) }
  })
  .catch({ bug: false, tags: [] })

const changeFactsOf = async (payload: Payload, recordIds: number[]): Promise<ChangeFacts[]> => {
  if (recordIds.length === 0) return []
  const found = await payload.db.drizzle.execute(
    sql`SELECT "data" FROM "records" WHERE "id" IN (${sql.join(recordIds.map((id) => sql`${id}`), sql`, `)})`,
  )
  return found.rows.map((entry) => changeData.parse(changeRow.parse(entry).data))
}

export type ReleaseReady = {
  sha: string
  tags: string[]
  tickets: { recordId: number; number: number }[]
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
  const { ready } = partition(state, await mergedTickets(payload, source.id))
  const finished = (await doneRuns(payload, f.product)).filter(
    (run) => !state.versions.some((version) => version.tag === run.version),
  )
  const released = new Set(finished.flatMap((run) => run.tickets.map((ticket) => ticket.recordId)))
  const tags = [...state.versions.map((version) => version.tag), ...finished.map((run) => run.version)]
  const tickets = ready.tickets.filter((ticket) => !released.has(ticket.recordId))
  const bump = bumpOf(await changeFactsOf(payload, tickets.map((ticket) => ticket.recordId)))
  const sha = state.staging?.sha ?? null
  const open = await openRun(payload, f.product)
  const refusal = open
    ? `Releasing ${open.version} is not finished yet.`
    : await refusalOf(payload, f, now, tickets.length, sha)
  return {
    sha: sha ?? '',
    tags,
    tickets: tickets.map(({ recordId, number }) => ({ recordId, number })),
    proposal: { version: nextVersion(tags, bump), bump },
    refusal,
  }
}

