import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { mayDecide } from './decide'
import type { ForgeWriter } from './forge/writer'
import { ProductObserving, WriteError } from './forge/errors'
import { MemoryInvalid, MemoryNotFound, NotAllowedToChangeMemory, type Who } from './memory'
import {
  cameBackRecords,
  preventionBody,
  preventionTitle,
  referenceOf,
  ticketLinks,
} from './memory-check'
import { statementRecord, type StatementRecord } from './views/statement-records'

const BUILDING = 'A check for this memory is already being built: wait for its ticket.'
const SINCE = 'A check for this memory is done: this memory is no longer handed to runs.'

const why = (memory: StatementRecord): string => {
  if (memory.scope !== 'product') {
    return 'A memory for one ticket cannot become a check: let it apply to the whole Product first.'
  }
  if (memory.off) return 'Switch this memory on first: a check is only made for an active memory.'
  return memory.check.kind === 'building' ? BUILDING : SINCE
}

const bodyOf = async (payload: Payload, workspace: number, memory: StatementRecord): Promise<string> => {
  const cameBack = await ticketLinks(payload, { workspace, records: await cameBackRecords(payload, memory.id) })
  const [source] = await ticketLinks(payload, { workspace, records: memory.ticket ? [memory.ticket.record] : [] })
  return preventionBody({
    text: memory.text,
    origin: { from: memory.from, text: memory.sourceText, ticket: source ?? null },
    cameBack,
  })
}

const lockOf = <T>(payload: Payload, id: number, work: () => Promise<T>): Promise<T> =>
  payload.db.drizzle.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${id})`)
    return work()
  })

const wrapped = (error: unknown): never => {
  if (error instanceof ProductObserving) {
    throw new MemoryInvalid(`${error.message} Switch the Product on in its settings, then try again.`)
  }
  throw error instanceof WriteError ? new MemoryInvalid(error.message) : error
}

export const makeCheck = async (
  payload: Payload,
  who: Who,
  f: { id: number },
  forge: Pick<ForgeWriter, 'openIssue'>,
): Promise<number> => {
  if (!mayDecide(who.person, who.workspace)) {
    throw new NotAllowedToChangeMemory(`Person ${who.person.id} may not change memory: ask a Bauherr of it.`)
  }
  return lockOf(payload, f.id, async () => {
    const memory = await statementRecord(payload, { workspace: who.workspace, id: f.id })
    if (!memory) throw new MemoryNotFound(`Memory ${f.id} is not in this Workspace: check the id.`)
    if (!memory.mayCheck) throw new MemoryInvalid(why(memory))
    const previous = memory.check.kind === 'discarded' ? memory.check.issue : null
    const issue = await forge
      .openIssue(
        { workspace: who.workspace, product: memory.product },
        {
          title: preventionTitle(memory.text),
          body: await bodyOf(payload, who.workspace, memory),
          reference: referenceOf(memory.id, previous),
        },
      )
      .catch(wrapped)
    await payload.db.drizzle.execute(
      sql`UPDATE "statements" SET "check_issue" = ${issue.number}, "updated_at" = now() WHERE "id" = ${memory.id}`,
    )
    return issue.number
  })
}
