import type { ReactNode } from 'react'
import { SettingsNav } from '../../components/SettingsNav'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <h1 className="title">Settings</h1>
      <div className="settings">
        <SettingsNav />
        <div className="stack">{children}</div>
      </div>
    </>
  )
}
