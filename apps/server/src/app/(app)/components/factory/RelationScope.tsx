'use client'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Roles } from '../../lib/board-relations'
import { Button } from '../ui/button'

type Scope = { selected: number | null; toggle: (recordId: number) => void; roles: Record<number, Roles> }

const ScopeContext = createContext<Scope | null>(null)

export function RelationScope({ roles, children }: { roles: Record<number, Roles>; children: ReactNode }) {
  const [selected, setSelected] = useState<number | null>(null)
  useEffect(() => {
    if (selected === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected])
  const toggle = (recordId: number) => setSelected((current) => (current === recordId ? null : recordId))
  return <ScopeContext.Provider value={{ selected, toggle, roles }}>{children}</ScopeContext.Provider>
}

const wordOf = (selected: Roles | undefined, recordId: number): string | null => {
  if (selected?.blockers.includes(recordId)) return 'Blocks this'
  if (selected?.blocked.includes(recordId)) return 'Blocked by this'
  return selected?.part.includes(recordId) ? 'Part of' : null
}

const TOGGLE = cn(
  'label relative z-10 h-auto rounded-sm border-border bg-card px-2 py-1 font-normal text-primary',
  'aria-pressed:border-primary aria-pressed:bg-accent',
)

export function RelationTag({ recordId, number, related }: { recordId: number; number: number; related: boolean }) {
  const scope = useContext(ScopeContext)
  if (scope === null) return null
  const { selected, toggle, roles } = scope
  const word = selected === null || selected === recordId ? null : wordOf(roles[selected], recordId)
  const state = selected === null ? null : selected === recordId ? 'selected' : word === null ? 'dim' : 'related'
  return (
    <>
      {state !== null && <span hidden data-rel={state} />}
      {word !== null && <span className="label text-primary">{word}</span>}
      {related && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className={TOGGLE}
          aria-pressed={selected === recordId}
          aria-label={`Related tickets of #${number}`}
          onClick={() => toggle(recordId)}
        >
          Related
        </Button>
      )}
    </>
  )
}
