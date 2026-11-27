import type { Backend, Forge, TicketSource } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { backendFor } from '../../lib/adapters'
import { connectionInput } from '../../lib/connection'
import { WRITE_KINDS } from '../events'
import { errorText } from '../mirror/map'
import { appendEvent } from '../record/store'
import { assertActive, WrongItemKind } from './errors'
import { loadWriteRow, type Target, type WriteRow } from './write-store'

export type WriteKind = (typeof WRITE_KINDS)[number]
export type WriterDeps = { backend: (connection: number) => Promise<Backend>; now: () => Date }

export type Ctx = { payload: Payload; deps: WriterDeps }
export type Session = { row: WriteRow; tickets: TicketSource; forge: Forge }
export type Step<T> = { call: (session: Session) => Promise<T>; mirror: (session: Session, result: T) => Promise<void> }

export const ticketId = (row: WriteRow): string => String(row.number)
const place = (row: WriteRow) => ({ repo: row.repo, number: row.number })

export const defaultDeps = (payload: Payload): WriterDeps => ({
  backend: async (connection) => backendFor(await connectionInput(payload, connection)),
  now: () => new Date(),
})

export const open = async (ctx: Ctx, target: Target, kind: 'issue' | 'pr'): Promise<Session> => {
  const row = await loadWriteRow(ctx.payload, target)
  assertActive(row)
  if (row.kind !== kind) {
    throw new WrongItemKind(`${row.repo}#${row.number} is a ${row.kind}: this write needs a ${kind}.`)
  }
  const backend = await ctx.deps.backend(row.connection)
  return { row, tickets: backend.tickets(row.repo), forge: backend.forge }
}

export const perform = async <T>(
  ctx: Ctx,
  target: Target,
  kind: WriteKind,
  session: Session,
  step: Step<T>,
): Promise<T> => {
  const data = { kind, target: place(session.row) }
  const append = (event: Parameters<typeof appendEvent>[2]) => appendEvent(ctx.payload, target.recordId, event)
  await append({ type: 'forge.write.started', data, actor: 'factory' })
  let result: T
  try {
    result = await step.call(session)
  } catch (error) {
    await append({ type: 'forge.write.failed', data: { ...data, reason: errorText(error) }, actor: 'factory' })
    throw error
  }
  await append({ type: 'forge.write.done', data, actor: 'factory' })
  await step.mirror(session, result)
  return result
}
