import type { ReactNode } from 'react'
import { isProductOwner } from '../../../../lib/people'
import { SettingsNav } from '../../components/SettingsNav'
import { requirePerson } from '../../lib/session'

/** Everyone may open Profile; a Product owner gets it without the Settings navigation, every other page checks `requireBauherr` itself. */
export default async function Layout({ children }: { children: ReactNode }) {
  const user = await requirePerson()
  if (isProductOwner(user)) return <div className="flex flex-col gap-4"><h1 className="sr-only">Settings</h1>{children}</div>
  return (
    <div className="grid grid-cols-[200px_minmax(0,720px)] items-start gap-8 max-sm:grid-cols-[minmax(0,1fr)] max-sm:gap-4 max-sm:pb-18">
      <SettingsNav admin={user.role === 'admin'} />
      <div className="flex flex-col gap-4">
        <h1 className="sr-only">Settings</h1>
        {children}
      </div>
    </div>
  )
}
