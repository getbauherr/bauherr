'use client'
import { createContext, useContext } from 'react'

export type SidebarContext = {
  state: 'expanded' | 'collapsed'
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

export const Context = createContext<SidebarContext | null>(null)

export function useSidebar(): SidebarContext {
  const context = useContext(Context)
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider.')
  return context
}
