import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { requireBauherr } from '../lib/session'
import { isAdmin } from '../lib/settings'

export async function AdminOnly({ children }: { children: ReactNode }) {
  if (!isAdmin(await requireBauherr())) notFound()
  return children
}
