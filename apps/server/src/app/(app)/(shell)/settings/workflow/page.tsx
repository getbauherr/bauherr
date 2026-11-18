import { notFound, redirect } from 'next/navigation'
import { currentWorkspace } from '../../../lib/session'
import { isAdmin } from '../../../lib/settings'

export default async function Workflow() {
  const { user } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  redirect('/workflow/edit')
}
