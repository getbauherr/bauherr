import type { Payload } from 'payload'

/** Claims `runId` through `claim_run`, first cancelling every other awaiting Run in the Workspace so it is the one `claim_next` would return. */
export const claimOnly = async (payload: Payload, call: (user: any, name: string, input: unknown) => Promise<any>, user: unknown, ws: number, runId: number | string) => {
  await payload.update({ collection: 'runs', where: { and: [{ workspace: { equals: ws } }, { status: { equals: 'awaiting_session' } }, { id: { not_equals: runId } }] }, data: { status: 'cancelled' }, overrideAccess: true })
  return call(user, 'claim_run', { runId })
}
