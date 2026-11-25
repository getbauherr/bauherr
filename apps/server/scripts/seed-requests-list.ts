import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { coreDbOn } from '../tests/core/db'
import { engineOn } from '../tests/core/harness'
import { seedScenario, type ScenarioNames } from '../tests/core/scenario'

const o = { overrideAccess: true } as const

export const REQUESTS_OWNER = 'po-requests@example.com'
const OWNER_LOGIN = 'po-requests-gh'

const TITLES: Record<keyof ScenarioNames, string> = {
  intakeQueued: 'Request just received',
  intakeWorking: 'Request being read',
  reporterAsked: 'The factory asked me a question',
  failedRuns: 'Request held up',
  reporterSilent: 'Request with no answer',
  briefQueued: 'Plan being written',
  briefCard: 'Plan waiting for my approval',
  building: 'Request being built',
  verifyRounds: 'Request sent back often',
  waitingChecks: 'Request waiting for checks',
  reviewing: 'Request being reviewed',
  verifying: 'Request being tested',
  resultCard: 'Change ready to try',
  accepted: 'Request that went live',
  closed: 'Request that was discarded',
  parked: 'Request waiting for the team',
}

const MINE: Partial<Record<keyof ScenarioNames, string>> = {
  reporterAsked: 'bug',
  resultCard: 'change',
  closed: 'bug',
}

const workspaceOf = async (payload: Payload): Promise<number> => {
  const found = await payload.find({
    collection: 'workspaces',
    where: { slug: { equals: 'request-list' } },
    limit: 1,
    ...o,
  })
  const data = { name: 'Request list', slug: 'request-list' }
  return Number((found.docs[0] ?? (await payload.create({ collection: 'workspaces', data, ...o }))).id)
}

const productOf = async (payload: Payload, workspace: number, slug: string, name: string): Promise<number> => {
  const found = await payload.find({ collection: 'products', where: { slug: { equals: slug } }, limit: 1, ...o })
  const data = { name, slug, workspace, state: 'active' as const }
  return Number((found.docs[0] ?? (await payload.create({ collection: 'products', data, ...o }))).id)
}

export const seedRequestList = async (
  payload: Payload,
  user: (address: string, role: string, extra: Record<string, unknown>) => Promise<unknown>,
) => {
  const workspace = await workspaceOf(payload)
  const withRequests = await productOf(payload, workspace, 'request-list-app', 'Requests App')
  const empty = await productOf(payload, workspace, 'request-list-empty', 'Requests Empty')
  await user(REQUESTS_OWNER, 'product-owner', {
    githubLogin: OWNER_LOGIN,
    assignments: [{ workspace, scope: 'products', products: [withRequests, empty] }],
  })
  const inWorkspace = { workspace: { equals: workspace } }
  const seeded = await payload.find({ collection: 'records', where: inWorkspace, limit: 1, depth: 0, ...o })
  if (seeded.docs.length) return
  const ids = { workspace, otherWorkspace: workspace, product: withRequests }
  const engine = engineOn(coreDbOn(payload, ids, async () => {}), undefined, new Date())
  const scenario = await seedScenario(engine, (name) => TITLES[name])
  for (const [name, type] of Object.entries(MINE)) {
    const id = scenario.names[name as keyof ScenarioNames]
    await payload.db.drizzle.execute(sql`UPDATE "records"
      SET "data" = jsonb_set(jsonb_set("data", '{source,reporter}', to_jsonb(${OWNER_LOGIN}::text)),
        '{type}', to_jsonb(${type}::text)) WHERE "id" = ${id}`)
  }
}
