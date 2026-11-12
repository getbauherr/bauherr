'use server'
import { revalidatePath } from 'next/cache'
import { run, type FormState } from '../../../lib/settings'
import { payloadClient, requirePerson } from '../../../lib/session'

/** Profile: links, changes or (empty) removes the signed-in person's own forge login. Open to a Product owner too; Payload's rules apply as on /api (one account per login, case ignored). */
export const saveOwnLogin = async (_prev: FormState, fd: FormData): Promise<FormState> => {
  const user = await requirePerson()
  const login = String(fd.get('githubLogin') ?? '').trim().replace(/^@/, '')
  const result = await run(async () => {
    await (await payloadClient()).update({ collection: 'bauherren', id: user.id, data: { githubLogin: login || null }, user, overrideAccess: false } as never)
  })
  if (result.saved) revalidatePath('/settings', 'layout')
  return result
}
