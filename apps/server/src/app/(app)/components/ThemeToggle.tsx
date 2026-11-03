'use client'
import { useEffect, useState } from 'react'
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from './ui/dropdown-menu'
import { Monitor, Moon, Sun } from './icons'

const modes = [
  { id: 'system', label: 'System', Icon: Monitor },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
] as const

const stored = () => {
  try {
    return localStorage.getItem('bauherr-theme') ?? 'system'
  } catch {
    return 'system'
  }
}

/** One row of three theme buttons for the avatar menu; picking keeps the menu open. */
export function ThemeRow() {
  const [mode, setMode] = useState<string>('system')
  useEffect(() => setMode(stored()), [])
  const pick = (id: string) => {
    setMode(id)
    const root = document.documentElement
    if (id === 'system') root.removeAttribute('data-theme')
    else root.dataset.theme = id
    try {
      id === 'system' ? localStorage.removeItem('bauherr-theme') : localStorage.setItem('bauherr-theme', id)
    } catch {}
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
