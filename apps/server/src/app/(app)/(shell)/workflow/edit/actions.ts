'use server'
import { revalidatePath } from 'next/cache'
import { applyFactory, type ApplyResult } from '../../../../../lib/factory'
import { personOf } from '../../../../../lib/person'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { isAdmin } from '../../../lib/settings'

const denied = (findings: string[]): ApplyResult => ({ ok: false, findings, changed: false, migrated: [] })

const factoryAs = async (yaml: string, base: number | null, opts: { dryRun?: boolean; note?: string }): Promise<ApplyResult> => {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) return denied(['Only an Admin can change the workflow.'])
  if (!workspace) return denied(['No Workspace selected.'])
  const r = await applyFactory(await payloadClient(), workspace.id, yaml, { by: personOf(user), via: 'ui', baseVersion: base, ...opts })
  if (!opts.dryRun && r.changed) {
    revalidatePath('/workflow/edit')
    revalidatePath('/settings', 'layout')
    revalidatePath('/team')
    revalidatePath('/')
  }
  return r
}

export const reviewDraft = async (yaml: string, base: number | null): Promise<ApplyResult> => factoryAs(yaml, base, { dryRun: true })

export const applyDraft = async (yaml: string, base: number | null, note: string): Promise<ApplyResult> => factoryAs(yaml, base, { note: (note ?? '').trim() || undefined })

export const setExpediteLane = async (on: boolean): Promise<{ error?: string }> => {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) return { error: 'Only an Admin can change this.' }
  if (!workspace) return { error: 'No Workspace selected.' }
  await (await payloadClient()).update({ collection: 'workspaces', id: workspace.id, data: { expediteLane: on }, user, overrideAccess: false } as never)
  revalidatePath('/workflow/edit')
  return {}
}

export const setPreemptForHotfix = async (on: boolean): Promise<{ error?: string }> => {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) return { error: 'Only an Admin can change this.' }
  if (!workspace) return { error: 'No Workspace selected.' }
  await (await payloadClient()).update({ collection: 'workspaces', id: workspace.id, data: { preemptForHotfix: on }, user, overrideAccess: false } as never)
  revalidatePath('/workflow/edit')
  return {}
}
