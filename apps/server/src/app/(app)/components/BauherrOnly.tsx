import type { ReactNode } from 'react'
import { requireBauherr } from '../lib/session'

export async function BauherrOnly({ children }: { children: ReactNode }) {
  await requireBauherr()
  return children
}
