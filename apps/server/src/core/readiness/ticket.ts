import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { mayDecide } from '../decide'
import { ProductObserving, WriteError } from '../forge/errors'
import type { ForgeWriter } from '../forge/writer'
import type { Who } from '../memory'
import type { CheckId } from './checks'
import { NotAllowedToChangeReadiness, ReadinessInvalid } from './errors'
import { findingOf } from './view'
import { openedTickets, openTicketOf, READINESS_KEY, readinessReference } from './tickets'

const wrapped = (error: unknown): never => {
  if (error instanceof ProductObserving) {
    throw new ReadinessInvalid(`${error.message} Switch the Product on in its settings, then try again.`)
  }
  throw error instanceof WriteError ? new ReadinessInvalid(error.message) : error
}

export const openReadinessTicket = async (
  payload: Payload,
  who: Who,
  f: { product: number; check: CheckId; now: Date },
  forge: Pick<ForgeWriter, 'openIssue'>,
): Promise<number> => {
  if (!mayDecide(who.person, who.workspace)) {
    throw new NotAllowedToChangeReadiness(`Person ${who.person.id} may not open a ticket here: ask a Bauherr of it.`)
  }
  return payload.db.drizzle.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('readiness'), ${f.product})`)
    const finding = await findingOf(payload, { workspace: who.workspace, product: f.product, now: f.now }, f.check)
    if (finding?.status !== 'gap' || finding.fix?.kind !== 'ticket') {
      throw new ReadinessInvalid('This gap is gone or cannot become a ticket: reload the page.')
    }
    const opened = await openedTickets(payload, f.product)
    const open = openTicketOf(opened, f.check)
    if (open) throw new ReadinessInvalid(`Ticket #${open.number} is open for this gap: wait for it.`)
    const previous = opened.find((entry) => entry.check === f.check)?.number ?? null
    const { title, ask } = finding.fix
    const issue = await forge
      .openIssue(
        { workspace: who.workspace, product: f.product },
        {
          title,
          body: `${finding.title}. ${finding.detail}\n\n## The ask\n\n${ask}`,
          reference: readinessReference(f.product, f.check, previous),
        },
      )
      .catch(wrapped)
    await tx.execute(sql`
      INSERT INTO "instance_state" ("key", "value") VALUES (${`${READINESS_KEY}${f.product}`},
        jsonb_build_object(${f.check}::text, ${issue.number}::integer))
      ON CONFLICT ("key") DO UPDATE SET "value" = "instance_state"."value" || EXCLUDED."value", "updated_at" = now()`)
    return issue.number
  })
}
