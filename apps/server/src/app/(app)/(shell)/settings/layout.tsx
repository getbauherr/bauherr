import type { ReactNode } from 'react'
import { SettingsNav } from '../../components/SettingsNav'
import { requireBauherr } from '../../lib/session'

export default async function Layout({ children }: { children: ReactNode }) {
  const user = await requireBauherr()
  return (
    <div
      className={
        'grid grid-cols-[200px_minmax(0,1fr)] items-start gap-8 ' +
        'max-sm:grid-cols-[minmax(0,1fr)] max-sm:gap-4 max-sm:pb-18'
      }
    >
      <SettingsNav admin={user.role === 'admin'} />
      <div className="flex w-full max-w-210 min-w-0 flex-col gap-4">
        <h1 className="sr-only">Settings</h1>
        {children}
      </div>
    </div>
  )
}
