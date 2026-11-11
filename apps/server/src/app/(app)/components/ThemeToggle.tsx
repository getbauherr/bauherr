'use client'
import { useEffect, useState } from 'react'
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from './ui/dropdown-menu'
import { Monitor, Moon, Sun } from './icons'
import { Button } from './ui/button'

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
    <DropdownMenuRadioGroup aria-label="Theme" value={mode} onValueChange={pick} className="mx-2 my-1 grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
      {modes.map((m) => (
        <DropdownMenuRadioItem key={m.id} value={m.id} onSelect={(e) => e.preventDefault()} className="min-w-0 justify-center gap-1.5 px-1.5 py-1 text-sm [&_svg]:size-4">
          <m.Icon />
          {m.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/** The theme as three buttons on a page (Settings > Profile); stored in this browser only. */
export function ThemePicker() {
  const [mode, setMode] = useState<string>('system')
  useEffect(() => setMode(storedTheme()), [])
  return (
    <div role="group" aria-label="Theme" className="flex gap-2">
      {modes.map((m) => (
        <Button key={m.id} type="button" variant="outline" aria-pressed={mode === m.id} className="aria-pressed:border-primary aria-pressed:bg-accent" onClick={() => (setMode(m.id), setTheme(m.id))}>
          <m.Icon />
          {m.label}
        </Button>
      ))}
    </div>
  )
}
