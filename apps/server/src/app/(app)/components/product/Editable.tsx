import type { ReactNode } from 'react'

export function Editable({ admin, children }: { admin: boolean; children: ReactNode }) {
  if (admin) return children
  return <fieldset disabled className="m-0 flex flex-col gap-4 border-0 p-0">{children}</fieldset>
}
