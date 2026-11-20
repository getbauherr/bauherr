'use server'
import { revalidatePath } from 'next/cache'
import { withLoginLock } from '../../../../../lib/login-lock'
import { textOf } from '../../../lib/form-data'
import { run, type FormState } from '../../../lib/settings'
import { payloadClient, requirePerson } from '../../../lib/session'

export const saveOwnLogin = async (_prev: FormState, fd: FormData): Promise<FormState> => {
  const user = await requirePerson()
  const login = textOf(fd, 'githubLogin').trim().replace(/^@/, '')
  const result = await run(async () => {
    const payload = await payloadClient()
    await withLoginLock(String(user.email), () =>
      payload.update({
        collection: 'bauherren',
        id: user.id,
        data: { githubLogin: login || null },
        user,
        overrideAccess: false,
      }),
    )
  })
  if (result.saved) revalidatePath('/settings', 'layout')
  return result
}
