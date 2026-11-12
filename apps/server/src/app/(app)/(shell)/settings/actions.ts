'use server'
import { randomBytes } from 'node:crypto'
import { artifactRules, parseReviewChecks } from '@bauherr/runner'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createLocalReq } from 'payload'
import { mintAgentKey, revokeAgentKey, revokeApiKey, rotateApiKey } from '../../../../lib/api-key'
import { backendFor } from '../../../../lib/adapters'
import { connectionInput, webOrigin } from '../../../../lib/connection'
import { createEmbedToken } from '../../../../lib/intake/embed'
import { unknownLogins } from '../../../../lib/gates'
import { suggestOverlapIgnore } from '../../../../lib/overlap'
import { parsePathSets, type PathSets } from '../../../../lib/path-sets'
import { forgeOf } from '../../../../lib/release'
import { gatewayEnabled, rotateKey, rotateSessionKey } from '../../../../lib/gateway'
import { refreshPrices } from '../../../../lib/prices'
import { SCAN_MAX_BUDGET_USD } from '../../../../lib/investigation'
import { startSecurityScan } from '../../../../lib/security-scan'
import { MERGE_MODES } from '../../../../lib/merge-mode'
import { redetectMergeMode, runPreflight } from '../../../../lib/merge-preflight'
import { PRESET_FIELDS } from '../../../../lib/providers'
import { assertAnotherAdmin, assertInWorkspace, blockedBy } from '../../../../lib/settings-guards'
import { deployErrors } from '../../lib/product-setup'
import { isAdmin, listRepos, only, presetFor, run, type FormState } from '../../lib/settings'
import { isTemplateName, lintTemplate } from '../../../../lib/template-text'
import { currentWorkspace, payloadClient, workspacesOf } from '../../lib/session'
import { OTHER_REPO, slugOf } from '../../lib/new-product'
import { isWebUrl } from '../../lib/url'
import { modeStages } from '../../../../lib/workflow'
import { workflowFor } from '../../../../lib/factory'
import { assignmentRows } from '../../../../lib/people'

type Form = (prev: FormState, fd: FormData) => Promise<FormState>

/** Writes go through the local API as the signed-in Bauherr with access control on, so Payload's validation and access rules apply exactly as on /api. */
async function ctx() {
  const { user, workspace } = await currentWorkspace()
  const payload = await payloadClient()
  const w = { user, overrideAccess: false } as const
  return { user, workspace, payload, w }
}
const act = (rename: Record<string, string>, fn: (c: Awaited<ReturnType<typeof ctx>>, fd: FormData) => Promise<string | void>): Form =>
  async (_prev, fd) => {
    const c = await ctx()
    const result = await run(() => fn(c, fd), rename)
    if (result.saved) {
      revalidatePath('/settings', 'layout')
      revalidatePath('/setup')
    }
    return result
  }
const s = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim()
const id = (fd: FormData) => Number(fd.get('id'))
const inWorkspace = (c: { workspace: { id: number } | null }) => {
  if (!c.workspace) throw new Error('No Workspace selected.')
  return c.workspace.id
}

/** Settings > General: the Workspace name and the progress-comment switch. */
export const saveGeneral = act({}, async ({ user, workspace, payload, w }, fd) => {
  only(user)
  await payload.update({ collection: 'workspaces', id: inWorkspace({ workspace }), data: { name: s(fd, 'name'), progressComments: fd.get('progressComments') === 'on' }, ...w } as never)
})

/** Settings > Models & budget (Admin only): budget unit, amount and auto share, model tiers and run modes. */
export const saveModels = act({ budgetUsd30d: 'budgetAmount', budgetTokens30d: 'budgetAmount', routerBudgetShare: 'routerBudgetShare' }, async ({ user, workspace, payload, w }, fd) => {
  only(user)
  const wsId = inWorkspace({ workspace })
  const unit = s(fd, 'budgetUnit') === 'tokens' ? 'tokens' : 'usd'
  const amount = s(fd, 'budgetAmount')
  const data: Record<string, unknown> = { budgetUnit: unit, [unit === 'usd' ? 'budgetUsd30d' : 'budgetTokens30d']: amount === '' ? null : Number(amount) }
  if (s(fd, 'routerBudgetShare')) data.routerBudgetShare = Number(s(fd, 'routerBudgetShare'))
  const { defaultModels: defaults, slugs } = await presetFor(wsId)
  const missing = (['cheap', 'standard', 'strong'] as const).filter((t) => !s(fd, `tier_${t}`) && !defaults)
  if (missing.length) throw Object.assign(new Error('Model tiers missing.'), { data: { errors: missing.map((t) => ({ path: `tier_${t}`, message: 'This provider has no default; set a model id' })) } })
  // Tiers are `<connection>/<model>`; a bare model id goes to the first Connection.
  const qualify = (v: string) => (!slugs.length || slugs.some((c) => v.startsWith(`${c}/`)) ? v : `${slugs[0]}/${v}`)
  const tiers = Object.fromEntries((['cheap', 'standard', 'strong'] as const).map((t) => [t, qualify(s(fd, `tier_${t}`) || defaults![t])]))
  const stages = Object.fromEntries(modeStages(workflowFor(wsId)).map((t) => [t, s(fd, `mode_${t}`)]).filter(([, v]) => v))
  Object.assign(data, { modelByTier: tiers, defaultMode: s(fd, 'defaultMode') || null, modeByStage: Object.keys(stages).length ? stages : null })
  await payload.update({ collection: 'workspaces', id: wsId, data, ...w } as never)
})

/** Settings > Knowledge: the Connection and repository of the Knowledge repo. */
export const saveKnowledge = act({}, async ({ user, workspace, payload, w }, fd) => {
  only(user)
  const wsId = inWorkspace({ workspace })
  const conn = Number(s(fd, 'knowledgeConnection')) || undefined
  await assertInWorkspace(payload, 'connections', [conn], wsId)
  await payload.update({ collection: 'workspaces', id: wsId, data: { knowledgeConnection: conn ?? null, knowledgeRepo: s(fd, 'knowledgeRepo') || null }, ...w } as never)
})

/** Paths that never hold a Build for overlap: the textarea (one glob per line) replaces the list; `add` appends one suggested path. */
export const saveOverlapIgnore = act({ ignore: 'ignore' }, async (c, fd) => {
  only(c.user)
  const wsId = inWorkspace(c)
  const product = id(fd)
  await assertInWorkspace(c.payload, 'products', [product], wsId)
  const current = ((await c.payload.findByID({ collection: 'products', id: product, select: { overlapIgnore: true }, depth: 0, overrideAccess: true })) as { overlapIgnore?: string[] }).overlapIgnore ?? []
  const lines = fd.has('ignore') ? s(fd, 'ignore').split('\n').map((l) => l.trim()).filter(Boolean) : [...current, s(fd, 'add')]
  if (lines.some((l) => /\s/.test(l))) throw Object.assign(new Error('Invalid glob.'), { data: { errors: [{ path: 'ignore', message: 'One path glob per line, without spaces' }] } })
  await c.payload.update({ collection: 'products', id: product, data: { overlapIgnore: [...new Set(lines)] }, ...c.w } as never)
})

/** The Product's named path sets (conditional workflow steps refer to them): the textarea replaces them; `add` appends one suggested name with an empty list. */
export const savePathSets = act({ sets: 'sets' }, async (c, fd) => {
  only(c.user)
  const product = id(fd)
  await assertInWorkspace(c.payload, 'products', [product], inWorkspace(c))
  const current = ((await c.payload.findByID({ collection: 'products', id: product, select: { pathSets: true }, depth: 0, overrideAccess: true })) as { pathSets?: PathSets }).pathSets ?? {}
  let pathSets: PathSets
  try {
    pathSets = fd.has('sets') ? parsePathSets(s(fd, 'sets')) : { ...current, [s(fd, 'add')]: current[s(fd, 'add')] ?? [] }
  } catch (e) {
    throw fieldError('sets', (e as Error).message)
  }
  await c.payload.update({ collection: 'products', id: product, data: { pathSets }, ...c.w } as never)
})

/** Reads the Product's last 100 merged pull requests from the forge (explicit action, never on render) and stores the suggested paths with the time on the Product. */
export const suggestOverlapPaths = act({}, async (c, fd) => {
  only(c.user)
  const product = id(fd)
  await assertInWorkspace(c.payload, 'products', [product], inWorkspace(c))
  const { backend, repo } = await forgeOf(c.payload, product)
  const items = await suggestOverlapIgnore(backend.forge, repo)
  await c.payload.update({ collection: 'products', id: product, data: { overlapSuggestions: { at: new Date().toISOString(), items } }, ...c.w } as never)
})

export const rotateWorkspaceKey = act({}, async ({ user, workspace, payload }) => {
  only(user)
  await rotateKey(await createLocalReq({ user }, payload), inWorkspace({ workspace }))
})

/** Admin: a new session key for this Workspace (the old one stops working); shown once, never stored by Bauherr. */
export const createSessionKey = act({}, async ({ user, workspace, payload }) => {
  only(user)
  if (!gatewayEnabled()) throw new Error('The gateway is off on this instance.')
  return rotateSessionKey(await createLocalReq({ user }, payload), inWorkspace({ workspace }))
})

/** Admin: fetches the price catalog now instead of waiting for the daily refresh; a refusal or failure is shown as the error. */
export const updatePricesNow = act({}, async ({ user, payload }) => {
  only(user)
  const status = await refreshPrices(payload, { force: true })
  if (status?.error) throw new Error(status.error.message)
  if (!status) throw new Error('Price updates are switched off on this instance (BAUHERR_PRICES_REFRESH=0).')
})

const inWs = (c: Awaited<ReturnType<typeof ctx>>, collection: string, ...ids: (number | undefined)[]) => assertInWorkspace(c.payload, collection, ids, inWorkspace(c))

/** Creates the Product (short name derived from the name when empty) and returns its id. */
const makeProduct = async (c: Awaited<ReturnType<typeof ctx>>, fd: FormData) => {
  const name = s(fd, 'name')
  const slug = s(fd, 'slug') || slugOf(name)
  if (!/^[a-z0-9-]+$/.test(slug)) throw Object.assign(new Error('Short name invalid.'), { data: { errors: [{ path: 'slug', message: 'Use lowercase letters, digits and dashes.' }] } })
  return (await c.payload.create({ collection: 'products', data: { name, slug, workspace: inWorkspace(c) }, ...c.w } as never)).id as number
}

const TEXT_FIELDS = ['stagingUrl', 'deployMode', 'deployWebhookUrl', 'deployChecks', 'gateOwners', 'productionWebhookUrl', 'productionChecks', 'releaseMode'] as const

/**
 * Saves the fields of one Product tab (`section`: deploy, approvals, checks or releases); only the fields the form posted are written, so a tab never resets another one.
 * Without `section` (step 3 of /setup) it saves the Deploy and Approvals fields.
 */
export const saveDeploy = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'products', id(fd))
  const section = s(fd, 'section')
  const sec = (g: string) => (section ? section === g : g === 'deploy' || g === 'approvals')
  const data: Record<string, unknown> = Object.fromEntries(TEXT_FIELDS.filter((k) => fd.has(k)).map((k) => [k, s(fd, k)]))
  if (fd.has('checkRetries')) data.checkRetries = Number(s(fd, 'checkRetries') || 1)
  if (fd.has('releaseReminderDays')) data.releaseReminderDays = Number(s(fd, 'releaseReminderDays') || 7)
  if (sec('approvals')) Object.assign(data, { autoMerge: fd.get('autoMerge') === 'on', expediteSkipStaging: fd.get('expediteSkipStaging') === 'on', productionGate: fd.get('productionGate') === 'on' })
  if (sec('releases')) data.releasePrerelease = fd.get('releasePrerelease') === 'on'
  const before = (await c.payload.findByID({ collection: 'products', id: id(fd), select: { stagingUrl: true, deployMode: true, deployWebhookUrl: true, productionWebhookUrl: true, productionGate: true, productionChecks: true, expediteSkipStaging: true }, ...c.w } as never)) as Record<string, any>
  const merged = { stagingUrl: '', deployWebhookUrl: '', productionWebhookUrl: '', productionChecks: '', deployMode: 'observe-ci', productionGate: false, ...before, ...data } as Parameters<typeof deployErrors>[0]
  const errors = Object.entries(deployErrors(merged)).filter(([path]) => path in data).map(([path, message]) => ({ path, message }))
  const days = data.releaseReminderDays as number | undefined
  if (days !== undefined && (!Number.isInteger(days) || days < 1)) errors.push({ path: 'releaseReminderDays', message: 'Enter a whole number of days, 1 or more.' })
  const retries = data.checkRetries as number | undefined
  if (retries !== undefined && (!Number.isInteger(retries) || retries < 0 || retries > 1)) errors.push({ path: 'checkRetries', message: 'Enter a whole number 0 or 1.' })
  if (typeof data.gateOwners === 'string') {
    const unknown = await unknownLogins(c.payload, id(fd), data.gateOwners)
    if (unknown.length) errors.push({ path: 'gateOwners', message: `GitHub does not know ${unknown.map((l) => `@${l}`).join(', ')}. Check the spelling.` })
  }
  if (fd.has('reviewChecks')) {
    try {
      const checks = parseReviewChecks(s(fd, 'reviewChecks')) ?? {}
      const rules = fd.has('proofRules') ? artifactRules(JSON.parse(s(fd, 'proofRules') || '[]')) : []
      data.reviewChecks = rules.length ? { ...checks, artifacts: rules } : Object.keys(checks).length ? checks : null
    } catch (e) {
      errors.push({ path: fd.has('proofRules') && /^rule \d/.test((e as Error).message) ? 'proofRules' : 'reviewChecks', message: (e as Error).message })
    }
  }
  if (errors.length) throw Object.assign(new Error('Release settings invalid.'), { data: { errors } })
  if ('expediteSkipStaging' in data) {
    const flipped = data.expediteSkipStaging !== !!before.expediteSkipStaging
    if (flipped) Object.assign(data, { expediteSkipStagingBy: data.expediteSkipStaging ? c.user.email : null, expediteSkipStagingAt: data.expediteSkipStaging ? new Date().toISOString() : null })
  }
  await c.payload.update({ collection: 'products', id: id(fd), data, ...c.w } as never)
})

/** Merge mode of a Product. Switching to `queue` or `train` re-runs the repo preflight and refuses while it has problems. */
export const saveMergeMode = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'products', id(fd))
  const mode = s(fd, 'mergeMode')
  if (!(MERGE_MODES as readonly string[]).includes(mode)) throw fieldError('mergeMode', 'Choose direct, queue or train.')
  const current = (await c.payload.findByID({ collection: 'products', id: id(fd), select: { mergeMode: true }, depth: 0, overrideAccess: true })) as { mergeMode?: string }
  if ((mode === 'queue' || mode === 'train') && current.mergeMode !== mode) {
    const preflight = await runPreflight(c.payload, id(fd), mode)
    if (!preflight.ok) throw fieldError('mergeMode', `${mode === 'queue' ? 'Queue' : 'Train'} mode is not ready: ${preflight.problems.join(' ')}`)
  }
  await c.payload.update({ collection: 'products', id: id(fd), data: { mergeMode: mode }, ...c.w } as never)
})

/** "Re-detect": asks the forge again and stores the detected mode with its preflight. */
export const saveSecurityScan = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'products', id(fd))
  const budget = s(fd, 'maxBudgetUsd')
  const turns = s(fd, 'maxTurns')
  const cron = s(fd, 'cron')
  if (budget && !(Number(budget) > 0 && Number(budget) <= SCAN_MAX_BUDGET_USD)) throw fieldError('maxBudgetUsd', `Enter an amount above 0 and up to ${SCAN_MAX_BUDGET_USD}.`)
  if (turns && !(Number.isInteger(Number(turns)) && Number(turns) >= 1)) throw fieldError('maxTurns', 'Enter a whole number, 1 or more.')
  if (cron.split(/\s+/).length !== 6) throw fieldError('cron', 'Use 6 fields: seconds minutes hours day month weekday.')
  await c.payload.update({ collection: 'products', id: id(fd), data: { securityScan: { enabled: fd.get('enabled') === 'on', cron, maxBudgetUsd: budget ? Number(budget) : null, maxTurns: turns ? Number(turns) : null } }, ...c.w } as never)
})

export const startScan = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'products', id(fd))
  await startSecurityScan(c.payload, id(fd))
})

export const redetectMerge = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'products', id(fd))
  await redetectMergeMode(c.payload, id(fd))
})

/** Adds a repository to a Product; "Read tickets" also adds its ticket source (the repository is removed again if that fails). */
const makeRepository = async (c: Awaited<ReturnType<typeof ctx>>, product: number, fd: FormData) => {
  const connection = Number(s(fd, 'connection')) || undefined
  const fullName = s(fd, 'fullName')
  await inWs(c, 'connections', connection)
  const repo = await c.payload.create({ collection: 'repositories', data: { fullName, product, workspace: inWorkspace(c) }, ...c.w } as never)
  if (fd.get('readTickets') !== 'on') return
  try {
    await c.payload.create({ collection: 'ticket_sources', data: { repo: fullName, connection, product, workspace: inWorkspace(c) }, ...c.w } as never)
  } catch (e) {
    await c.payload.delete({ collection: 'repositories', id: repo.id, ...c.w } as never)
    throw e
  }
}
export const addRepository = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'products', id(fd))
  await makeRepository(c, id(fd), fd)
})

/** Repositories of a Connection for the Repository select; null when the forge does not answer in time. Admin only. */
export async function repositoriesOf(connection: number): Promise<string[] | null> {
  const c = await ctx()
  only(c.user)
  await inWs(c, 'connections', Number(connection))
  return listRepos(Number(connection))
}

const fieldError = (path: string, message: string) => Object.assign(new Error(message), { data: { errors: [{ path, message }] } })

/** Product, repository and ticket source in one go; what was created is deleted again when a later create fails. `open=1` continues to the new Product's Staging section. */
export const createProductWithRepo = act({}, async (c, fd) => {
  only(c.user)
  const slug = s(fd, 'slug') || slugOf(s(fd, 'name'))
  if ((await c.payload.count({ collection: 'products', where: { and: [{ slug: { equals: slug } }, { workspace: { equals: inWorkspace(c) } }] }, overrideAccess: true } as never)).totalDocs) throw fieldError('slug', 'Another Product already uses this short name.')
  if (s(fd, 'fullName') === OTHER_REPO) fd.set('fullName', s(fd, 'repoOther'))
  if (!s(fd, 'fullName')) throw fieldError('fullName', 'Choose a repository.')
  if (!/^[\w.-]+(?:\/[\w.-]+)+$/.test(s(fd, 'fullName'))) throw fieldError('fullName', 'Use owner/name, for example acme/shop.')
  const product = await makeProduct(c, fd)
  fd.set('readTickets', 'on')
  try {
    await makeRepository(c, product, fd)
  } catch (e) {
    await c.payload.delete({ collection: 'products', id: product, ...c.w } as never)
    throw e
  }
  await redetectMergeMode(c.payload, product)
  if (fd.get('open') === '1') redirect(`/settings/products/${product}?tab=deploy#staging`)
})

/** The token is shown once as the ready-made script tag; only its hash is stored. */
export const mintEmbedToken = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'products', id(fd))
  const allowedOrigins = s(fd, 'origins').split(/[\s,]+/).filter(Boolean)
  if (!allowedOrigins.length) throw Object.assign(new Error('Origins missing.'), { data: { errors: [{ path: 'origins', message: 'Add at least one origin' }] } })
  if (!allowedOrigins.every(isWebUrl)) throw Object.assign(new Error('Origins invalid.'), { data: { errors: [{ path: 'origins', message: 'Each origin must be an http(s) URL' }] } })
  const perHour = s(fd, 'maxSessionsPerHour')
  if (perHour && !(Number.isInteger(Number(perHour)) && Number(perHour) >= 1)) throw fieldError('maxSessionsPerHour', 'Enter a whole number, 1 or more.')
  const token = await createEmbedToken(c.payload, { product: id(fd), name: s(fd, 'name'), allowedOrigins, ...(perHour && { maxSessionsPerHour: Number(perHour) }) })
  return `<script src="${process.env.PUBLIC_URL ?? 'http://localhost:3000'}/intake/widget.js" data-token="${token}"></script>`
})
export const revokeEmbedToken = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'embed_tokens', id(fd))
  await c.payload.update({ collection: 'embed_tokens', id: id(fd), data: { revokedAt: new Date().toISOString() }, overrideAccess: true } as never)
})

const COLLECTIONS = ['products', 'repositories', 'ticket_sources', 'bauherren']
export const removeDoc = act({}, async (c, fd) => {
  only(c.user)
  const collection = s(fd, 'collection')
  if (!COLLECTIONS.includes(collection)) throw new Error('Unknown collection.')
  if (collection === 'bauherren') {
    if (id(fd) === c.user.id) throw new Error('You cannot remove yourself.')
    await assertAnotherAdmin(c.payload, id(fd))
  } else await inWs(c, collection, id(fd))
  if (collection === 'products') {
    const blocked = await blockedBy(c.payload, 'products', id(fd))
    if (blocked) throw new Error(`Still referenced by ${blocked}.`)
  }
  await c.payload.delete({ collection, id: id(fd), ...c.w } as never)
  if (collection === 'products') redirect('/settings/products')
})

export const saveConnection = act({}, async (c, fd) => {
  only(c.user)
  const kind = s(fd, 'kind')
  const data: Record<string, unknown> = { name: s(fd, 'name'), kind }
  if (kind === 'llm-provider') {
    data.provider = s(fd, 'provider')
    for (const k of PRESET_FIELDS) if (fd.has(k)) data[k] = s(fd, k)
  }
  if (kind === 'gitlab') data.config = { baseUrl: webOrigin({ kind, config: { baseUrl: s(fd, 'baseUrl') } }) }
  if (s(fd, 'secret')) data.secret = s(fd, 'secret')
  if (id(fd)) {
    await inWs(c, 'connections', id(fd))
    if (kind !== 'llm-provider' && s(fd, 'secret')) data.capabilities = { ...(await connectionInput(c.payload, id(fd))).capabilities, verifiedAt: undefined, lastError: undefined }
    await c.payload.update({ collection: 'connections', id: id(fd), data, ...c.w } as never)
  } else await c.payload.create({ collection: 'connections', data: { ...data, workspace: inWorkspace(c) }, ...c.w } as never)
})

/** LLM providers: re-saves unchanged, the afterChange hook verifies the provider again. Forges: asks the forge who the token belongs to and stores the outcome in `capabilities`. */
export const verifyConnection = act({}, async (c, fd) => {
  only(c.user)
  await inWs(c, 'connections', id(fd))
  const conn = await connectionInput(c.payload, id(fd))
  if (conn.kind === 'llm-provider') {
    await c.payload.update({ collection: 'connections', id: id(fd), data: {}, ...c.w } as never)
    return
  }
  let failure: { message: string; refused: boolean } | null = null
  try {
    await backendFor(conn, { maxRetries: 0, timeoutMs: 10_000 }).tickets('').whoami()
  } catch (e) {
    failure = { message: (e as Error).message, refused: [401, 403].includes((e as { status?: number }).status ?? 0) }
  }
  await c.payload.update({ collection: 'connections', id: id(fd), data: { capabilities: { ...conn.capabilities, verifiedAt: failure ? null : new Date().toISOString(), lastError: failure?.message ?? null } }, overrideAccess: true } as never)
  if (failure) throw new Error(`${failure.refused ? 'The forge did not accept the token' : 'Could not verify the token'}: ${failure.message}`)
})

const tenants = (fd: FormData) => fd.getAll('workspaces').map(Number)
const known = async (c: Awaited<ReturnType<typeof ctx>>, ids: number[]) => {
  const own = (await workspacesOf(c.user)).map((w) => w.id)
  if (ids.some((i) => !own.includes(i))) throw new Error('Not in this Workspace')
}
export const createBauherr = act({}, async (c, fd) => {
  only(c.user)
  if (s(fd, 'role') !== 'admin' && s(fd, 'role') !== 'bauherr') throw new Error('Choose Admin or Bauherr.')
  await known(c, tenants(fd))
  const password = randomBytes(12).toString('base64url')
  await c.payload.create({ collection: 'bauherren', data: { email: s(fd, 'email'), password, role: s(fd, 'role'), tenants: tenants(fd).map((tenant) => ({ tenant })) }, ...c.w } as never)
  return `Temporary password (shown once): ${password}`
})

/** Whether the Workspace's first GitHub Connection knows `login`; true when there is none to ask or GitHub cannot answer. */
const githubKnows = async (c: Awaited<ReturnType<typeof ctx>>, login: string): Promise<boolean> => {
  const first = (await c.payload.find({ collection: 'connections', where: { and: [{ workspace: { equals: inWorkspace(c) } }, { kind: { equals: 'github' } }] }, sort: 'id', limit: 1, depth: 0, overrideAccess: true } as never)).docs[0]
  if (!first) return true
  try {
    return await backendFor(await connectionInput(c.payload, first.id as number), { maxRetries: 0, timeoutMs: 10_000 }).tickets('').userExists(login)
  } catch {
    return true // GitHub unreachable or rate-limited: saving is never blocked, the login stays unverified
  }
}

/** One assignment row from the Workspace, scope and Products fields of the form. */
const assignmentFrom = async (c: Awaited<ReturnType<typeof ctx>>, fd: FormData) => {
  const workspace = Number(s(fd, 'workspace'))
  await known(c, [workspace])
  const scope = s(fd, 'scope') === 'workspace' ? 'workspace' : 'products'
  return { workspace, scope, products: scope === 'products' ? [...new Set(fd.getAll('products').map(Number))] : [] }
}

/** A Product owner: login plus an assignment, nothing else. The temporary password is shown once, as for a Bauherr. */
export const createProductOwner = act({}, async (c, fd) => {
  only(c.user)
  const assignment = await assignmentFrom(c, fd)
  const password = randomBytes(12).toString('base64url')
  await c.payload.create({ collection: 'bauherren', data: { email: s(fd, 'email'), password, role: 'product-owner', assignments: [assignment] }, ...c.w } as never)
  return `Temporary password (shown once): ${password}`
})

/** Sets, replaces or (`scope=none`) removes the Product owner's assignment in one Workspace; their other assignments stay. */
export const saveAssignment = act({}, async (c, fd) => {
  only(c.user)
  const target = await c.payload.findByID({ collection: 'bauherren', id: id(fd), depth: 0, overrideAccess: true })
  if (target.role !== 'product-owner') throw new Error('Not a Product owner.')
  const workspace = Number(s(fd, 'workspace'))
  const rest = assignmentRows(target.assignments).filter((r) => r.workspace !== workspace)
  await c.payload.update({ collection: 'bauherren', id: id(fd), data: { assignments: s(fd, 'scope') === 'none' ? rest : [...rest, await assignmentFrom(c, fd)] }, ...c.w } as never)
})

/** Bauherr <-> Product owner. Never your own account, never the last Admin; the assignments are cleared on the way out and a new Product owner starts with none. */
export const changeRole = act({}, async (c, fd) => {
  only(c.user)
  const role = s(fd, 'role')
  if (role !== 'bauherr' && role !== 'product-owner') throw new Error('Choose Bauherr or Product owner.')
  if (id(fd) === c.user.id) throw new Error('You cannot change your own role.')
  const target = await c.payload.findByID({ collection: 'bauherren', id: id(fd), depth: 0, overrideAccess: true })
  // The form names the role it was rendered for: a stale tab or a double submit cannot change the account back.
  if (target.role !== s(fd, 'from')) throw new Error('This account changed meanwhile. Reload the page.')
  if (target.role === 'admin') await assertAnotherAdmin(c.payload, id(fd))
  if (target.role !== role) await c.payload.update({ collection: 'bauherren', id: id(fd), data: { role }, ...c.w } as never)
})

export const saveBauherr = act({}, async (c, fd) => {
  only(c.user)
  const ids = tenants(fd)
  await known(c, ids)
  const target = await c.payload.findByID({ collection: 'bauherren', id: id(fd), depth: 0, overrideAccess: true })
  if (target.role === 'product-owner') throw new Error('Use the Product owner form.')
  if (s(fd, 'role') !== 'admin' && s(fd, 'role') !== 'bauherr') throw new Error('Choose Admin or Bauherr.')
  if (id(fd) === c.user.id && s(fd, 'role') !== target.role) throw new Error('You cannot change your own role.')
  if (target.role === 'admin' && (s(fd, 'role') !== 'admin' || (id(fd) === c.user.id && !ids.length))) await assertAnotherAdmin(c.payload, id(fd))
  const login = s(fd, 'githubLogin').replace(/^@/, '')
  if (login && login !== target.githubLogin && !(await githubKnows(c, login))) throw Object.assign(new Error('GitHub login unknown.'), { data: { errors: [{ path: 'githubLogin', message: `GitHub does not know @${login}. Check the spelling.` }] } })
  await c.payload.update({ collection: 'bauherren', id: id(fd), data: { role: s(fd, 'role'), tenants: ids.map((tenant) => ({ tenant })), githubLogin: login || null, oidcSubject: s(fd, 'oidcSubject') || null }, ...c.w } as never)
})

/** Ends a failed-login lockout; the Bauherr can sign in again at once. */
export const unlockBauherr = act({}, async (c, fd) => {
  only(c.user)
  await c.payload.update({ collection: 'bauherren', id: id(fd), data: { lockUntil: null, loginAttempts: 0 }, overrideAccess: true } as never)
})

/** The creating Admin joins the new Workspace's tenants. */
export const createWorkspace = act({}, async (c, fd) => {
  only(c.user)
  const name = s(fd, 'name')
  const slug = slugOf(s(fd, 'slug') || name)
  if (!name) throw new Error('Name is required.')
  if (!slug) throw Object.assign(new Error('Slug is invalid.'), { data: { errors: [{ path: 'slug', message: 'Use letters or digits' }] } })
  const ws = await c.payload.create({ collection: 'workspaces', data: { name, slug }, ...c.w } as never)
  const me = await c.payload.findByID({ collection: 'bauherren', id: c.user.id as number, depth: 0, overrideAccess: true })
  const have = ((me.tenants ?? []) as { tenant: number | { id: number } }[]).map((t) => ({ tenant: typeof t.tenant === 'object' ? t.tenant.id : t.tenant }))
  await c.payload.update({ collection: 'bauherren', id: me.id, data: { tenants: [...have, { tenant: ws.id as number }] }, overrideAccess: true } as never)
})

const mcpAdd = (key: string) => `claude mcp add --transport http bauherr ${process.env.PUBLIC_URL ?? 'http://localhost:3000'}/mcp --header "Authorization: Bearer ${key}"`

/** Own record only: the target is always the signed-in Bauherr, never a form value. The key appears once, as the ready-made `claude mcp add` line. */
export const mintOwnAgentKey = act({}, async ({ user, payload }, fd) => mcpAdd(await mintAgentKey(payload, user, s(fd, 'label'))))

export const revokeOwnAgentKey = act({}, async ({ user, payload }, fd) => revokeAgentKey(payload, user, id(fd)))

/** The personal (human) key: for scripted owner use only, it can approve gates. */
export const rotateOwnKey = act({}, async ({ user, payload }) => mcpAdd(await rotateApiKey(payload, user)))

export const revokeOwnKey = act({}, async ({ user, payload }) => revokeApiKey(payload, user))

/** Admin: saves the Workspace's version of a template; refused while the linter finds an error (the factory depends on those parts). */
export const saveTemplate = act({}, async ({ user, workspace, payload }, fd) => {
  const wsId = inWorkspace({ workspace })
  only(user)
  const name = s(fd, 'name')
  if (!isTemplateName(name)) throw new Error('Unknown template.')
  const body = String(fd.get('body') ?? '').replace(/\r\n/g, '\n').trim()
  const errors = lintTemplate(name, body).filter((f) => f.level === 'error')
  if (errors.length) throw new Error(errors.map((f) => f.message).join(' '))
  const found = (await payload.find({ collection: 'templates', where: { workspace: { equals: wsId }, name: { equals: name } }, limit: 1, depth: 0, overrideAccess: true })).docs[0]
  if (found) await payload.update({ collection: 'templates', id: found.id, data: { body, updatedBy: user.email }, overrideAccess: true })
  else await payload.create({ collection: 'templates', data: { name, body, updatedBy: user.email, workspace: wsId } as never, overrideAccess: true })
})

/** Admin: drops the Workspace's version, so the pack's default applies again. */
export const resetTemplate = act({}, async ({ user, workspace, payload }, fd) => {
  const wsId = inWorkspace({ workspace })
  only(user)
  const name = s(fd, 'name')
  if (!isTemplateName(name)) throw new Error('Unknown template.')
  const found = (await payload.find({ collection: 'templates', where: { workspace: { equals: wsId }, name: { equals: name } }, limit: 1, depth: 0, overrideAccess: true })).docs[0]
  if (found) await payload.delete({ collection: 'templates', id: found.id, overrideAccess: true })
})
