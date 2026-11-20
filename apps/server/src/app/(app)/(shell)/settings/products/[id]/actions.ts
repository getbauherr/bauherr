'use server'
import { revalidatePath } from 'next/cache'
import { forgeCheckNames, productSettings, type ProductSettings } from '../../../../../../core/views/product-settings'
import { currentWorkspace, payloadClient } from '../../../../lib/session'
import { only, run, type FormState } from '../../../../lib/settings'
import { parseExecutor, parseGates, parseIntake, parseProof } from '../../../../lib/product-sections'

type Build = (product: ProductSettings, fd: FormData, forgeChecks: string[]) => Record<string, unknown>

async function save(fd: FormData, build: Build): Promise<FormState> {
  const { user, workspace } = await currentWorkspace()
  const payload = await payloadClient()
  const result = await run(async () => {
    only(user)
    if (!workspace) throw new Error('No Workspace selected.')
    const filter = { workspace: workspace.id, product: Number(fd.get('id')) }
    const product = await productSettings(payload, filter)
    if (!product) throw new Error('Not in this Workspace')
    const data = build(product, fd, await forgeCheckNames(payload, filter))
    await payload.update({ collection: 'products', id: product.id, data, user, overrideAccess: false })
  })
  if (result.saved) revalidatePath('/settings', 'layout')
  return result
}

export async function saveExecutor(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, () => parseExecutor(fd))
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
    const { requiredChecks, deployChecks, stagingUrl } = parseProof(fd)
    return { requiredChecks: requiredChecks.join(', '), deployChecks: deployChecks.join(', '), stagingUrl }
  })
}

export async function copyForgeChecks(_prev: FormState, fd: FormData): Promise<FormState> {
  return save(fd, (product, _fd, forgeChecks) => {
    if (product.requiredChecks.trim() !== '') throw new Error('Required checks are already set.')
    if (!forgeChecks.length) throw new Error('The forge does not require any checks.')
    return { requiredChecks: forgeChecks.join(', ') }
  })
}
