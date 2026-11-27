import type { TicketSource } from '@bauherr/adapters'
import { checkNewRelation } from '../relations/relate'
import { syncForgeLink } from '../relations/forge-link'
import { normalised, type Edge } from '../relations/rules'
import { deleteEdge, insertEdge, itemFacts } from '../relations/store'
import { RelationRefused, typeOf } from '../relations/types'
import { TargetNotFound } from './errors'
import { open, perform, type Ctx } from './write-session'

const relationEnds = async (ctx: Ctx, input: Edge) => {
  const type = typeOf(input.type)
  const edge = normalised(input, type)
  const facts = await itemFacts(ctx.payload, [edge.from, edge.to])
  const from = facts.get(edge.from)
  const to = facts.get(edge.to)
  if (!from || !to) throw new TargetNotFound(`Tickets ${edge.from} and ${edge.to} must both be mirrored.`)
  return { type, edge, from, to }
}

export const changeRelation = async (
  ctx: Ctx,
  recordId: number,
  input: Edge,
  change: 'add' | 'remove',
): Promise<void> => {
  const { type, edge, from, to } = await relationEnds(ctx, input)
  if (change === 'add') await checkNewRelation(ctx.payload, from.workspace, edge)
  const save = () =>
    change === 'add' ? insertEdge(ctx.payload, from.workspace, edge) : deleteEdge(ctx.payload, edge)
  const { forge } = type
  if (!forge) return save()
  if (from.repo !== to.repo) {
    throw new RelationRefused(`"${type.key}" is kept on the forge, which links tickets of one repository only.`)
  }
  const [mine, other] = forge.ticketIs === 'to' ? [to, from] : [from, to]
  const target = { recordId, itemId: mine.id }
  const session = await open(ctx, target, 'issue')
  await perform(ctx, target, change === 'add' ? 'relation-add' : 'relation-remove', session, {
    call: ({ tickets }) => {
      const link = { field: forge.field, mine: mine.number, other: other.number }
      return syncForgeLink(tickets, type, link, change)
    },
    mirror: save,
  })
}

export const linkSeries = async (ctx: Ctx, tickets: TicketSource, input: Edge): Promise<void> => {
  const { type, edge, from, to } = await relationEnds(ctx, input)
  await checkNewRelation(ctx.payload, from.workspace, edge)
  if (type.forge) {
    const [mine, other] = type.forge.ticketIs === 'to' ? [to, from] : [from, to]
    await syncForgeLink(tickets, type, { field: type.forge.field, mine: mine.number, other: other.number }, 'add')
  }
  await insertEdge(ctx.payload, from.workspace, edge)
}

