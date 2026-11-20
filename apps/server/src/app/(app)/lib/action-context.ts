import { revalidatePath } from 'next/cache'
import { assertInWorkspace } from '../../../lib/settings-guards'
import { textOf } from './form-data'
import { run, type FormState } from './settings'
import { currentWorkspace, payloadClient } from './session'

export type Form = (prev: FormState, fd: FormData) => Promise<FormState>

export async function ctx() {
  const { user, workspace } = await currentWorkspace()
  const payload = await payloadClient()
  const w = { user, overrideAccess: false } as const
  return { user, workspace, payload, w }
}

export type Ctx = Awaited<ReturnType<typeof ctx>>

export const act =
  (rename: Record<string, string>, fn: (c: Ctx, fd: FormData) => Promise<string | void>): Form =>
  async (_prev, fd) => {
    const c = await ctx()
    const result = await run(() => fn(c, fd), rename)
    if (result.saved) {
      revalidatePath('/settings', 'layout')
    }
    return result
  }

export const s = (fd: FormData, k: string) => textOf(fd, k).trim()
export const id = (fd: FormData) => Number(fd.get('id'))

export const inWorkspace = (c: { workspace: { id: number } | null }) => {
  if (!c.workspace) throw new Error('No Workspace selected.')
  return c.workspace.id
}

export const inWs = (c: Ctx, collection: string, ...ids: (number | undefined)[]) =>
  assertInWorkspace(c.payload, collection, ids, inWorkspace(c))

export const fieldError = (path: string, message: string) =>
  Object.assign(new Error(message), { data: { errors: [{ path, message }] } })
