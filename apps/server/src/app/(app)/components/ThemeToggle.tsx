'use client'
import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from './icons'
import { Popover } from './Popover'

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

export function ThemeToggle() {
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
  const { Icon } = modes.find((m) => m.id === mode) ?? modes[0]
  return (
    <Popover label={<><Icon /><span className="sr">Theme: </span>{modes.find((m) => m.id === mode)?.label}</>}>
        {modes.map((m) => (
          <button key={m.id} className="row" aria-pressed={mode === m.id} onClick={() => pick(m.id)}>
            <m.Icon />
            {m.label}
          </button>
        ))}
    </Popover>
  )
}
