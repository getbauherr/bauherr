import type { Payload, Where } from 'payload'
import { workflowFor } from './factory'
import { live } from './workspace-delete'
import { byKind, type Kind } from './workflow'

/** Every Workspace with the name its workflow gives the `kind` stage (a Workspace whose workflow lacks the kind is left out). */
export const stagesOfKind = async (payload: Payload, kind: Kind): Promise<{ workspace: number | string; name: string }[]> =>
  (await payload.find({ collection: 'workspaces', where: live, select: {}, pagination: false, depth: 0, overrideAccess: true })).docs.flatMap((w) => {
    const name = byKind(workflowFor(w.id), kind)?.name
    return name ? [{ workspace: w.id, name }] : []
  })

/** Where: the Ticket is in the `kind` stage of its own Workspace's workflow. */
export const inKindStage = async (payload: Payload, kind: Kind): Promise<Where> => {
  const pairs = await stagesOfKind(payload, kind)
  return pairs.length ? { or: pairs.map((p) => ({ and: [{ workspace: { equals: p.workspace } }, { stage: { equals: p.name } }] as Where[] })) } : { id: { equals: -1 } }
}
