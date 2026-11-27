'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Button } from '../../ui/button'
import { PROTO_VARIANTS, type ProtoVariant } from './proto-data'

const NAMES: Record<ProtoVariant, string> = {
  a: 'The one table',
  b: 'Table + trend',
  c: 'Cost per accepted ticket first',
}

export function ProtoSwitcher({ variant }: { variant: ProtoVariant }) {
  const router = useRouter()
  const index = PROTO_VARIANTS.indexOf(variant)
  const go = (to: number) => {
    router.replace(`/insights?variant=${PROTO_VARIANTS[(to + PROTO_VARIANTS.length) % PROTO_VARIANTS.length]}`)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) return
      if (event.key === 'ArrowLeft') go(index - 1)
      if (event.key === 'ArrowRight') go(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <nav
      aria-label="Prototype variant"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border
        bg-card p-1 shadow-md"
    >
      <Button variant="ghost" size="icon-sm" aria-label="Previous variant" onClick={() => go(index - 1)}>←</Button>
      {PROTO_VARIANTS.map((entry) => (
        <Button
          key={entry}
          size="sm"
          variant={entry === variant ? 'default' : 'ghost'}
          aria-current={entry === variant ? 'true' : undefined}
          onClick={() => go(PROTO_VARIANTS.indexOf(entry))}
          className="rounded-full"
        >
          {entry.toUpperCase()}
        </Button>
      ))}
      <span className="small hidden px-2 text-muted-foreground sm:inline">{NAMES[variant]}</span>
      <Button variant="ghost" size="icon-sm" aria-label="Next variant" onClick={() => go(index + 1)}>→</Button>
    </nav>
  )
}
