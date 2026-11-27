'use server'
import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { assertInWorkspace } from '../../../../../../lib/settings-guards'
import { currentWorkspace, payloadClient } from '../../../../lib/session'
import { only, run, type FormState } from '../../../../lib/settings'

async function change(fd: FormData, data: Record<string, unknown>, notice?: string): Promise<FormState> {
  const { user, workspace } = await currentWorkspace()
  const payload = await payloadClient()
  const result = await run(async () => {
    only(user)
    if (!workspace) throw new Error('No Workspace selected.')
    const id = Number(fd.get('id'))
    await assertInWorkspace(payload, 'products', [id], workspace.id)
    await payload.update({ collection: 'products', id, data, user, overrideAccess: false })
    return notice
  })
  if (result.saved) revalidatePath('/settings', 'layout')
  return result
}

export async function saveAlerts(_prev: FormState, fd: FormData): Promise<FormState> {
  return change(fd, { incidentIntake: fd.get('incidentIntake') === 'on' })
}

export async function createAlertSecret(_prev: FormState, fd: FormData): Promise<FormState> {
  const secret = randomBytes(32).toString('hex')
  return change(fd, { incidentSecret: secret }, secret)
}
