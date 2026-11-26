'use server'
import { revalidatePath } from 'next/cache'
import { createWriter } from '../../../../../../core/forge/writer'
import { defaultDeps } from '../../../../../../core/mirror/sync'
import { checkIdOf, proposedChange, settingData } from '../../../../../../core/readiness/fix'
import { refreshReadiness } from '../../../../../../core/readiness/refresh'
import { openReadinessTicket } from '../../../../../../core/readiness/ticket'
import { forgeCheckNames, productSettings, type ProductSettings } from '../../../../../../core/views/product-settings'
import { currentWorkspace, payloadClient } from '../../../../lib/session'
import { only, run, type FormState } from '../../../../lib/settings'
import { parseExecutor, parseGates, parseIntake, parseProof, parseReleaseMode } from '../../../../lib/product-sections'

type Build = (
  product: ProductSettings,
  fd: FormData,
  forgeChecks: string[],
) => Record<string, unknown> | Promise<Record<string, unknown>>

async function save(fd: FormData, build: Build): Promise<FormState> {
  const { user, workspace } = await currentWorkspace()
  const payload = await payloadClient()
  const result = await run(async () => {
    only(user)
    if (!workspace) throw new Error('No Workspace selected.')
    const filter = { workspace: workspace.id, product: Number(fd.get('id')) }
    const product = await productSettings(payload, filter)
    if (!product) throw new Error('Not in this Workspace')
    const data = await build(product, fd, await forgeCheckNames(payload, filter))
    await payload.update({ collection: 'products', id: product.id, data, user, overrideAccess: false })
  })
  if (result.saved) revalidatePath('/settings', 'layout')
  return result
}

export async function saveExecutor(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => parseExecutor(fd))
}

export async function saveReleaseMode(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => parseReleaseMode(fd))
}

export async function saveIntake(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => {
    const { excludedLabels, ...rest } = parseIntake(fd)
    return { ...rest, intakeExcludedLabels: excludedLabels }
  })
}

export async function saveGates(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, (product) => parseGates(fd, product.pathSets))
}

export async function saveProof(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => {
    const { requiredChecks, deployChecks, deployWaitMinutes, stagingUrl } = parseProof(fd)
    const checks = { requiredChecks: requiredChecks.join(', '), deployChecks: deployChecks.join(', ') }
    return { ...checks, deployWaitMinutes, stagingUrl }
  })
}

export async function copyForgeChecks(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, (product, _fd, forgeChecks) => {
    if (product.requiredChecks.trim() !== '') throw new Error('Required checks are already set.')
    if (!forgeChecks.length) throw new Error('The forge does not require any checks.')
    return { requiredChecks: forgeChecks.join(', ') }
  })
}

export async function saveReadinessFix(_prev: FormState, fd: FormData): Promise<FormState> {
  const { workspace } = await currentWorkspace()
  const payload = await payloadClient()
  return save(fd, async (product) => {
    const filter = { workspace: workspace?.id ?? 0, product: product.id, now: new Date() }
    return settingData(await proposedChange(payload, filter, checkIdOf(fd.get('check'))), product)
  })
}

export async function checkReadinessNow(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, workspace } = await currentWorkspace()
  const payload = await payloadClient()
  const result = await run(async () => {
    only(user)
    if (!workspace) throw new Error('No Workspace selected.')
    const filter = { workspace: workspace.id, product: Number(fd.get('id')) }
    if (!(await productSettings(payload, filter))) throw new Error('Not in this Workspace')
    const { errors } = await refreshReadiness(payload, defaultDeps(payload), filter)
    if (errors.length > 0) throw new Error(`Could not read the repository: ${errors.join('; ')}`)
  })
  revalidatePath('/settings', 'layout')
  revalidatePath('/releases')
  return result
}

export async function makeReadinessTicket(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, workspace } = await currentWorkspace()
  const payload = await payloadClient()
  const result = await run(async () => {
    if (!workspace) throw new Error('No Workspace selected.')
    const person = { id: String(user.id), role: user.role, workspaceIds: [workspace.id] }
    const input = { product: Number(fd.get('id')), check: checkIdOf(fd.get('check')), now: new Date() }
    await openReadinessTicket(payload, { person, workspace: workspace.id }, input, createWriter(payload))
  })
  if (result.saved) revalidatePath('/settings', 'layout')
  return result
}
