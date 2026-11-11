import { redirect } from 'next/navigation'

/** The workflow moved to its editor; a `#factory-file` or `#wip` fragment survives the redirect and the editor opens the matching tab. */
export default function Workflow() {
  redirect('/workflow/edit')
}
