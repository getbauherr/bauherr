'use server'
import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { assertInWorkspace } from '../../../../lib/settings-guards'
import { currentWorkspace, payloadClient } from '../../lib/session'
import { only, run, type FormState } from '../../lib/settings'

export async function createWebhookSecret(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, workspace } = await currentWorkspace()
  const payload = await payloadClient()
  const result = await run(async () => {
    only(user)
    const id = Number(fd.get('id'))
    if (!workspace) throw new Error('No Workspace selected.')
    await assertInWorkspace(payload, 'connections', [id], workspace.id)
    const connection = await payload.findByID({
      collection: 'connections',
      id,
      depth: 0,
      select: { kind: true },
      overrideAccess: true,
    })
    if (connection.kind === 'llm-provider') throw new Error('Only forge Connections have a webhook.')
    const secret = randomBytes(32).toString('hex')
    const data = { webhookSecret: secret }
    await payload.update({ collection: 'connections', id, data, user, overrideAccess: false })
    return secret
  }, {})
  if (result.saved) revalidatePath('/settings', 'layout')
  return result
}
