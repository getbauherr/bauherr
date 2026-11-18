import type { Payload } from 'payload'

export const claimOnly = async (payload: Payload, call: (user: any, name: string, input: unknown) => Promise<any>, user: unknown, ws: number, runId: number | string) => {
  await payload.update({ collection: 'runs', where: { and: [{ workspace: { equals: ws } }, { status: { equals: 'awaiting_session' } }, { id: { not_equals: runId } }] }, data: { status: 'cancelled' }, overrideAccess: true })
  return call(user, 'claim_run', { runId })
}
