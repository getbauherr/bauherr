import type { Payload } from 'payload'
import { coreDbOn } from '../tests/core/db'
import { mirrorSource } from '../tests/core/scenario'
import { buildOpening } from '../src/core/retro/opening'
import { addMessage, createRetro, loadRetro, saveAgreed } from '../src/core/retro/store'
import { seedTicket, shipped, type Shape } from './seed-insights'

const o = { overrideAccess: true } as const
const REPO = 'insights/app'

const calm = (number: number, title: string, doneDaysAgo: number): Shape => ({
  number: 10 + number,
  title,
  doneDaysAgo,
  events: [[5, 'intake.accepted'], [5, 'brief.approved', { by: 'rule' }], ...shipped(120)],
  runs: [{ stage: 'build', role: 'builder', created: 5, started: 7, finished: 60 }],
})

const DAY_MS = 86_400_000

const SHAPES: Shape[] = [
  calm(1, 'Show the year in the header', 3),
  calm(2, 'Round totals to one decimal', 4),
  calm(3, 'Link the report from the list', 6),
  {
    number: 20,
    title: 'Rebuild the export dialog',
    doneDaysAgo: 2,
    events: [
      [5, 'intake.accepted'],
      [5, 'brief.approved', { by: 'rule' }],
      [60, 'build.submitted', { runId: '1', patchId: 'p1', headSha: 'abc', pr: 5 }],
      [70, 'verify.changes'],
      [80, 'verify.changes'],
      [90, 'verify.changes'],
      [100, 'result.sent-back', { note: 'The dialog is not what I asked for.' }],
      [110, 'result.sent-back', { note: 'Still wrong.' }],
      [200, 'build.submitted', { runId: '2', patchId: 'p2', headSha: 'def', pr: 5 }],
      [210, 'verify.passed', { runId: '3', patchId: 'p2', headSha: 'def' }],
      [211, 'ship.merged', { sha: 'm2' }],
      [260, 'result.accepted'],
    ],
    runs: [{ stage: 'build', role: 'builder', created: 5, started: 7, finished: 60 }],
  },
]

export const seedRetro = async (
  payload: Payload,
  ensureUser: (address: string, tenant: number) => Promise<unknown>,
): Promise<void> => {
  const where = { slug: { equals: 'retro' } }
  if ((await payload.find({ collection: 'workspaces', where, limit: 1, ...o })).docs.length) return
  const workspaceData = { name: 'Retro', slug: 'retro' }
  const workspace = Number((await payload.create({ collection: 'workspaces', data: workspaceData, ...o })).id)
  const secret = 'e2e-dummy-secret'
  const connectionData = { name: 'GitHub Retro', kind: 'github', config: {}, secret, workspace } as const
  const connection = Number((await payload.create({ collection: 'connections', data: connectionData, ...o })).id)
  const productData = { name: 'Retro App', slug: 'retro-app', workspace, state: 'active' }
  const product = Number((await payload.create({ collection: 'products', data: productData, ...o })).id)
  const sourceData = { repo: 'retro/app', product, connection, cursor: '2026-10-30T09:00:00Z', workspace }
  await payload.create({ collection: 'ticket_sources', data: sourceData, ...o })
  await ensureUser('retro-bauherr@example.com', workspace)
  const ids = { workspace, otherWorkspace: workspace, product }
  const { item } = await mirrorSource({ db: coreDbOn(payload, ids, async () => {}) }, REPO)
  for (const shape of SHAPES) {
    await seedTicket(payload, ids, shape)
    await item(shape.number, { title: shape.title })
  }
  const range = { from: new Date(Date.now() - 30 * DAY_MS), to: new Date(Date.now() + DAY_MS) }
  const opening = await buildOpening(payload, { workspace, product, range })
  const retroId = await createRetro(payload, {
    workspace,
    product,
    ...range,
    label: 'Seeded range',
    createdBy: 'seed',
    opening,
  })
  const retro = await loadRetro(payload, workspace, retroId)
  if (!retro) throw new Error('the seeded Retro vanished')
  const proposals = [
    {
      id: 'p1',
      level: 'product' as const,
      title: 'Should a change that is sent back twice get a mockup before Build?',
      cause: 'The far-off ticket was built without a mockup and came back several times.',
      evidence: opening.tickets[0] ? [opening.tickets[0].recordId] : [],
      confidence: 'high' as const,
      change: { section: 'Brief' as const, remove: null, add: '- A change a user sees gets a mockup before Build.' },
    },
  ]
  const message = 'The export dialog stands out. What went well from your side, and what did not?'
  await addMessage(payload, retro, { role: 'assistant', body: message, parts: { proposals, raw: '{}' } })
  await saveAgreed(payload, retroId, ['p1'])
}
