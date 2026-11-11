import { notFound, redirect } from 'next/navigation'
import { currentWorkspace } from '../../../lib/session'
import { isAdmin } from '../../../lib/settings'

/** The workflow moved to its editor; a `#factory-file` or `#wip` fragment survives the redirect and the editor opens the matching tab. Admin only, like the editor: nobody else learns the address. */
export default async function Workflow() {
  const { user } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  redirect('/workflow/edit')
}
