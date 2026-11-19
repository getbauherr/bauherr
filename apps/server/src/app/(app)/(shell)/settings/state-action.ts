'use server'
import { revalidatePath } from 'next/cache'
import { assertInWorkspace } from '../../../../lib/settings-guards'
import { currentWorkspace, payloadClient } from '../../lib/session'
import { only, run, type FormState } from '../../lib/settings'

const STATES = ['observing', 'active'] as const

export async function setProductState(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, workspace } = await currentWorkspace()
  const payload = await payloadClient()
  const result = await run(async () => {
    only(user)
    const id = Number(fd.get('id'))
    const wanted = fd.get('state')
    const state = STATES.find((s) => s === wanted)
    if (!workspace) throw new Error('No Workspace selected.')
    if (!state) throw new Error('Choose observing or active.')
    await assertInWorkspace(payload, 'products', [id], workspace.id)
    await payload.update({ collection: 'products', id, data: { state }, user, overrideAccess: false })
  }, {})
  if (result.saved) revalidatePath('/settings', 'layout')
  return result
}
