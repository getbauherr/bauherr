'use server'
import { revalidatePath } from 'next/cache'
import { withLoginLock } from '../../../../../lib/login-lock'
import { run, type FormState } from '../../../lib/settings'
import { payloadClient, requirePerson } from '../../../lib/session'

/** Profile: links, changes or (empty) removes the signed-in person's own forge login. Open to a Product owner too; Payload's rules apply as on /api (one account per login, case ignored). */
export const saveOwnLogin = async (_prev: FormState, fd: FormData): Promise<FormState> => {
  const user = await requirePerson()
  const login = String(fd.get('githubLogin') ?? '').trim().replace(/^@/, '')
  const result = await run(async () => {
    const payload = await payloadClient()
    // In the sign-in queue: a sign-in of this account under way would write back the row it read and revert the edit.
    await withLoginLock(String(user.email), () => payload.update({ collection: 'bauherren', id: user.id, data: { githubLogin: login || null }, user, overrideAccess: false } as never))
  })
  if (result.saved) revalidatePath('/settings', 'layout')
  return result
}
