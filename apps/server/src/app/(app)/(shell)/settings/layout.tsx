import type { ReactNode } from 'react'
import { SettingsNav } from '../../components/SettingsNav'
import { requireBauherr } from '../../lib/session'

export default async function Layout({ children }: { children: ReactNode }) {
  const user = await requireBauherr()
  return (
    <>
      <h1 className="title">Settings</h1>
      <div className="settings">
        <SettingsNav admin={user.role === 'admin'} />
        <div className="stack">{children}</div>
      </div>
    </>
  )
}
