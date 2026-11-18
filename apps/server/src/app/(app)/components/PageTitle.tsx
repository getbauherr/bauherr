'use client'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const Context = createContext<(label: string | null) => void>(() => {})
const Label = createContext<string | null>(null)

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [label, setLabel] = useState<string | null>(null)
  return (
    <Context.Provider value={setLabel}>
      <Label.Provider value={label}>{children}</Label.Provider>
    </Context.Provider>
  )
}

export const usePageTitle = (): string | null => useContext(Label)

export function PageTitle({ children }: { children: string }) {
  const set = useContext(Context)
  useEffect(() => {
    set(children)
    return () => set(null)
  }, [set, children])
  return null
}
