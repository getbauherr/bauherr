import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createTestDb, type TestDb } from './helpers/test-db'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('../src/app/(app)/lib/session', () => ({
  currentWorkspace: async () => signedIn,
  payloadClient: async () => payload,
  workspacesOf: async () => [],
}))

const o = { overrideAccess: true } as const
const num = (value: unknown) => z.coerce.number().parse(value)
let payload: Payload
let signedIn: unknown
let testDb: TestDb

beforeAll(async () => {
  testDb = await createTestDb('product_sections')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) for (const item of [value].flat()) data.append(key, item)
  return data
}

const PATH_SETS = { security: ['src/auth/**'], ui: ['src/app/**'] }

const setup = async (slug: string, role: 'admin' | 'bauherr' = 'admin') => {
  const created = await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })
  const workspace = num(created.id)
  const data = { email: `${slug}@x.io`, password: 'pw-123456', role, tenants: [{ tenant: workspace }] }
  const user = await payload.create({ collection: 'bauherren', data, ...o })
  const product = { name: slug, slug, workspace, pathSets: PATH_SETS }
  const made = await payload.create({ collection: 'products', data: product, ...o })
  signedIn = { user, workspaces: [], workspace: created }
  return { workspace, product: num(made.id) }
}

const read = async (product: number) =>
  z.record(z.string(), z.unknown()).parse(await payload.findByID({ collection: 'products', id: product, ...o }))

const actions = () => import('../src/app/(app)/(shell)/settings/products/[id]/actions')

const INTAKE = {
  outsideIssuesPerDay: '8',
  reporterRemindDays: '3',
  reporterSilentDays: '10',
  excludedLabels: 'wontfix, , question, wontfix',
}
const UNTOUCHED = { backlogBriefLimit: 5, executor: 'session', riskAreas: [] }

describe('saveIntake', () => {
  it('saves the intake fields, trims and de-duplicates labels, and touches nothing else', async () => {
    const { saveIntake } = await actions()
    const { product } = await setup('sec-intake')
    const result = await saveIntake({}, form({ id: String(product), ...INTAKE }))
    expect(result.saved).toBe(true)
    expect(await read(product)).toMatchObject({
      ...UNTOUCHED,
      intakeExcludedLabels: ['wontfix', 'question'],
      outsideIssuesPerDay: 8,
      reporterRemindDays: 3,
      reporterSilentDays: 10,
      autoClose: false,
    })
    await saveIntake({}, form({ id: String(product), ...INTAKE, autoClose: 'on' }))
    expect(await read(product)).toMatchObject({ autoClose: true })
  })

  it.each([
    ['outsideIssuesPerDay', '0'],
    ['outsideIssuesPerDay', '51'],
    ['reporterRemindDays', '0'],
    ['reporterRemindDays', '91'],
    ['reporterSilentDays', '2.5'],
    ['reporterSilentDays', 'soon'],
  ])('refuses %s = %s and saves nothing', async (field, value) => {
    const { saveIntake } = await actions()
    const { product } = await setup(`sec-bad-${field}-${value}`.replace(/[^a-z0-9-]/gi, ''))
    const result = await saveIntake({}, form({ id: String(product), ...INTAKE, [field]: value }))
    expect(result.fields?.[field]).toContain('Enter a whole number')
    expect(await read(product)).toMatchObject({ outsideIssuesPerDay: 5, reporterRemindDays: 7, reporterSilentDays: 21 })
  })

  it('wants the silence to count after the reminder', async () => {
    const { saveIntake } = await actions()
    const { product } = await setup('sec-order')
    const result = await saveIntake({}, form({ id: String(product), ...INTAKE, reporterSilentDays: '3' }))
    expect(result.fields?.reporterSilentDays).toContain('more days')
  })
})

describe('saveGates', () => {
  it('saves risk areas and the Brief limit, and touches nothing else', async () => {
    const { saveGates } = await actions()
    const { product } = await setup('sec-gates')
    const chosen = { riskAreas: ['security', 'ui'], backlogBriefLimit: '9', autoAcceptMaxSendBack: '10' }
    expect((await saveGates({}, form({ id: String(product), ...chosen }))).saved).toBe(true)
    expect(await read(product)).toMatchObject({
      riskAreas: ['security', 'ui'],
      backlogBriefLimit: 9,
      outsideIssuesPerDay: 5,
      autoClose: true,
    })
    await saveGates({}, form({ id: String(product), backlogBriefLimit: '9', autoAcceptMaxSendBack: '10' }))
    expect(await read(product)).toMatchObject({ riskAreas: [], backlogBriefLimit: 9 })
  })

  it('keeps auto-accept off unless switched on and stores its send-back threshold', async () => {
    const { saveGates } = await actions()
    const { product } = await setup('sec-gates-auto')
    const fields = { id: String(product), backlogBriefLimit: '5', autoAcceptMaxSendBack: '15' }
    expect(await read(product)).toMatchObject({ autoAccept: false, autoAcceptMaxSendBack: 10 })
    expect((await saveGates({}, form({ ...fields, autoAccept: 'on' }))).saved).toBe(true)
    expect(await read(product)).toMatchObject({ autoAccept: true, autoAcceptMaxSendBack: 15 })
    await saveGates({}, form(fields))
    expect(await read(product)).toMatchObject({ autoAccept: false, autoAcceptMaxSendBack: 15 })
    const send = (percent: string) => saveGates({}, form({ ...fields, autoAcceptMaxSendBack: percent }))
    expect((await send('101')).fields?.autoAcceptMaxSendBack).toContain('0 to 100')
    expect((await send('-1')).fields?.autoAcceptMaxSendBack).toContain('0 to 100')
  })

  it('refuses a risk area that is not a path set and a limit out of bounds', async () => {
    const { saveGates } = await actions()
    const { product } = await setup('sec-gates-bad')
    const base = { autoAcceptMaxSendBack: '10' }
    const send = (fields: Record<string, string | string[]>) =>
      saveGates({}, form({ id: String(product), ...base, ...fields }))
    expect((await send({ riskAreas: ['billing'], backlogBriefLimit: '5' })).fields?.riskAreas).toContain('billing')
    expect((await send({ backlogBriefLimit: '0' })).fields?.backlogBriefLimit).toContain('1 to 50')
    expect((await send({ backlogBriefLimit: '51' })).fields?.backlogBriefLimit).toContain('1 to 50')
    expect(await read(product)).toMatchObject({ riskAreas: [], backlogBriefLimit: 5 })
  })
})

describe('saveProof', () => {
  const PROOF = { requiredChecks: ' test , lint,test', deployChecks: 'deploy-staging', deployWaitMinutes: '45' }

  it('trims and de-duplicates check names and keeps the staging address', async () => {
    const { saveProof } = await actions()
    const { product } = await setup('sec-proof')
    const stagingUrl = ' https://staging.example.com '
    expect((await saveProof({}, form({ id: String(product), ...PROOF, stagingUrl }))).saved).toBe(true)
    expect(await read(product)).toMatchObject({
      ...UNTOUCHED,
      requiredChecks: 'test, lint',
      deployChecks: 'deploy-staging',
      deployWaitMinutes: 45,
      stagingUrl: 'https://staging.example.com',
    })
  })

  it.each(['4', '1441', 'soon'])('refuses %s minutes as the deploy wait', async (minutes) => {
    const { saveProof } = await actions()
    const { product } = await setup(`sec-proof-wait-${minutes}`)
    const result = await saveProof({}, form({ id: String(product), ...PROOF, deployWaitMinutes: minutes }))
    expect(result.fields?.deployWaitMinutes).toBeTruthy()
  })

  it('refuses a staging address that is not a web address', async () => {
    const { saveProof } = await actions()
    const { product } = await setup('sec-proof-bad')
    const result = await saveProof({}, form({ id: String(product), ...PROOF, stagingUrl: 'ftp://x' }))
    expect(result.fields?.stagingUrl).toContain('https://')
    expect(await read(product)).not.toMatchObject({ requiredChecks: 'test, lint' })
  })
})

describe('saveExecutor', () => {
  it('saves the executor only', async () => {
    const { saveExecutor } = await actions()
    const { product } = await setup('sec-executor')
    expect((await saveExecutor({}, form({ id: String(product), executor: 'runner' }))).saved).toBe(true)
    expect(await read(product)).toMatchObject({ executor: 'runner', backlogBriefLimit: 5 })
    expect((await saveExecutor({}, form({ id: String(product), executor: 'robot' }))).fields?.executor).toBeTruthy()
    expect(await read(product)).toMatchObject({ executor: 'runner' })
  })
})

describe('copyForgeChecks', () => {
  const connect = async (workspace: number, product: number, names: string[]) => {
    const connection = { name: `c${product}`, kind: 'github', config: {}, secret: 'x', workspace }
    const made = await payload.create({ collection: 'connections', data: connection, ...o })
    const source = { repo: 'a/b', product, connection: num(made.id), workspace }
    const row = await payload.create({ collection: 'ticket_sources', data: source, ...o })
    await payload.db.drizzle.execute(
      sql`UPDATE "ticket_sources" SET "required_check_names" = ${JSON.stringify(names)}::jsonb
        WHERE "id" = ${num(row.id)}`,
    )
  }

  it('copies the checks the forge requires, once, and only while the Product has none', async () => {
    const { copyForgeChecks } = await actions()
    const { workspace, product } = await setup('sec-copy')
    const send = () => copyForgeChecks({}, form({ id: String(product) }))
    expect((await send()).error).toContain('does not require')
    await connect(workspace, product, ['test', 'lint'])
    expect((await send()).saved).toBe(true)
    expect(await read(product)).toMatchObject({ requiredChecks: 'lint, test' })
    expect((await send()).error).toContain('already set')
  })
})

describe('who may call them', () => {
  const NAMES = ['saveExecutor', 'saveIntake', 'saveGates', 'saveProof', 'copyForgeChecks'] as const
  const FIELDS = {
    saveExecutor: { executor: 'runner' },
    saveIntake: INTAKE,
    saveGates: { backlogBriefLimit: '9' },
    saveProof: { requiredChecks: 'test', deployChecks: '', deployWaitMinutes: '60', stagingUrl: '' },
    copyForgeChecks: {},
  }

  it('refuses a member who is not an Admin', async () => {
    const mod = await actions()
    const { product } = await setup('sec-member', 'bauherr')
    for (const name of NAMES) {
      const result = await mod[name]({}, form({ id: String(product), ...FIELDS[name] }))
      expect(result.error, name).toBeTruthy()
    }
    expect(await read(product)).toMatchObject({ ...UNTOUCHED, outsideIssuesPerDay: 5 })
  })

  it('refuses a Product of another Workspace', async () => {
    const mod = await actions()
    const { product: foreign } = await setup('sec-foreign')
    await setup('sec-mine')
    for (const name of NAMES) {
      const result = await mod[name]({}, form({ id: String(foreign), ...FIELDS[name] }))
      expect(result.error, name).toBe('Not in this Workspace')
    }
    expect(await read(foreign)).toMatchObject(UNTOUCHED)
  })
})
