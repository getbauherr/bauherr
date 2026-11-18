import type { Payload } from 'payload'

const count = async (payload: Payload, collection: string, where: Record<string, unknown>) =>
  (await payload.count({ collection, where, overrideAccess: true } as never)).totalDocs
const why = (parts: [number, string][]) => parts.filter(([n]) => n).map(([n, s]) => `${n} ${s}`).join(', ')

const PRODUCT_REFS = [['repositories', 'repositories'], ['ticket_sources', 'ticket sources'], ['tickets', 'tickets'], ['workflow_versions', 'workflow versions'], ['embed_tokens', 'widget tokens'], ['intake_sessions', 'intake sessions']] as const

export async function blockedBy(payload: Payload, collection: 'products' | 'connections', id: number): Promise<string> {
  if (collection === 'connections') return why([[await count(payload, 'ticket_sources', { connection: { equals: id } }), 'ticket sources']])
  const byProduct = { product: { equals: id } }
  return why(await Promise.all(PRODUCT_REFS.map(async ([c, label]) => [await count(payload, c, byProduct), label] as [number, string])))
}

export async function assertInWorkspace(payload: Payload, collection: string, ids: (number | undefined)[], workspace: number): Promise<void> {
  const wanted = [...new Set(ids.filter((i): i is number => i != null))]
  if (!wanted.length) return
  if ((await count(payload, collection, { id: { in: wanted }, workspace: { equals: workspace } })) !== wanted.length) throw new Error('Not in this Workspace')
}

export async function assertAnotherAdmin(payload: Payload, id: number): Promise<void> {
  if (!(await count(payload, 'bauherren', { role: { equals: 'admin' }, id: { not_equals: id } }))) throw new Error('Add another Admin first')
}
