'use client'
import { useEffect, useState } from 'react'
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from './ui/dropdown-menu'
import { Monitor, Moon, Sun } from './icons'

const modes = [
  { id: 'system', label: 'System', Icon: Monitor },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
] as const

export const storedTheme = () => {
  try {
    return localStorage.getItem('bauherr-theme') ?? 'system'
  } catch {
    return 'system'
  }
}

export const setTheme = (id: string) => {
  const root = document.documentElement
  if (id === 'system') root.removeAttribute('data-theme')
  else root.dataset.theme = id
  try {
    id === 'system' ? localStorage.removeItem('bauherr-theme') : localStorage.setItem('bauherr-theme', id)
  } catch {}
}

export const toggleTheme = () => setTheme((document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark')

/** One row of three theme buttons for the avatar menu; picking keeps the menu open. */
export function ThemeRow() {
  const [mode, setMode] = useState<string>('system')
  useEffect(() => setMode(storedTheme()), [])
  const pick = (id: string) => {
    setMode(id)
    setTheme(id)
  }
  return (
    <DropdownMenuRadioGroup aria-label="Theme" value={mode} onValueChange={pick} className="flex items-center gap-1 px-2 py-1">
      {modes.map((m) => (
        <DropdownMenuRadioItem key={m.id} value={m.id} onSelect={(e) => e.preventDefault()} className="flex-1 justify-center">
          <m.Icon />
          {m.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}
