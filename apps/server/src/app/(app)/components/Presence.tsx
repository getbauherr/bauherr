'use client'
import Link from 'next/link'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Presence = { working: number; idle: number }

const Ctx = createContext<Presence>({ working: 0, idle: 0 })
export const usePresence = () => useContext(Ctx)

export const presenceText = ({ working, idle }: Presence, sep = ', ') => [working && `${working} working`, idle && `${idle} idle`].filter(Boolean).join(sep) || 'No agents connected'

export function PresenceProvider({ initial, ms = 5000, off, children }: { initial: Presence; ms?: number; off?: boolean; children: ReactNode }) {
  const [p, setP] = useState(initial)
  useEffect(() => {
    if (off) return
    const poll = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch('/api/presence', { cache: 'no-store' })
        if (!res.ok) return
        const next = (await res.json()) as Presence
        setP((cur) => (cur.working === next.working && cur.idle === next.idle ? cur : next))
      } catch {
      }
    }
    const id = setInterval(poll, ms)
    document.addEventListener('visibilitychange', poll)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [ms, off])
  return <Ctx.Provider value={p}>{children}</Ctx.Provider>
}

export function PresencePill() {
  const p = usePresence()
  const none = !p.working && !p.idle
  return (
    <Link href="/team" data-testid="presence-pill" className="small flex h-9 items-center gap-2 rounded-full border border-border px-3 whitespace-nowrap outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring max-md:hidden">
      {none ? (
        <span className="text-muted-foreground">No agents connected</span>
      ) : (
        <>
          <span aria-hidden className={`size-2 rounded-full ${p.working ? 'bg-ok' : 'bg-muted-foreground'}`} />
          <span>{presenceText(p, ' · ')}</span>
        </>
      )}
    </Link>
  )
}

export function PresenceDot() {
  const p = usePresence()
  if (!p.working && !p.idle) return null
  return (
    <span data-testid="presence-dot" role="img" aria-label={presenceText(p)} className="ml-auto flex items-center gap-1.5 font-mono text-xs/4 group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:top-1 group-data-[collapsible=icon]:right-1 group-data-[collapsible=icon]:ml-0">
      <span aria-hidden className={`size-2 rounded-full ${p.working ? 'bg-ok' : 'bg-muted-foreground'}`} />
      {p.working > 0 && <span aria-hidden className="group-data-[collapsible=icon]:hidden">{p.working}</span>}
    </span>
  )
}
