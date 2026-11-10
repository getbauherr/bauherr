'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { InboxGroup } from '../lib/inbox'
import { DecisionCard } from './DecisionCard'

/** The Inbox cards by checkpoint. A decided card leaves at once (the server refresh follows); `j`/`k` or the arrows move between cards, Enter opens the Ticket. */
export function InboxList({ groups, admin }: { groups: InboxGroup[]; admin: boolean }) {
  const router = useRouter()
  const root = useRef<HTMLDivElement>(null)
  const [gone, setGone] = useState<number[]>([])
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [role=dialog], button, a, summary')) return
      const cards = Array.from(root.current?.querySelectorAll<HTMLElement>('article[data-decision]') ?? [])
      const at = cards.indexOf(t.closest('article[data-decision]') as HTMLElement)
      const go = (i: number) => (e.preventDefault(), cards[Math.min(cards.length - 1, Math.max(0, i))]?.focus())
      if (e.key === 'j' || e.key === 'ArrowDown') go(at + 1)
      else if (e.key === 'k' || e.key === 'ArrowUp') go(at < 0 ? 0 : at - 1)
      else if (e.key === 'Enter' && at >= 0) router.push(`/tickets/${cards[at]!.dataset.decision}`)
    }
    document.addEventListener('keydown', on)
    return () => document.removeEventListener('keydown', on)
  }, [router])
  const multi = new Set(groups.flatMap((g) => g.items.map((i) => i.product.id))).size > 1
  return (
    <div ref={root} className="flex flex-col gap-6">
      {groups.map((g) => {
        const left = g.items.filter((i) => !gone.includes(i.id)).length
        return (
          <section key={g.checkpoint} aria-label={g.checkpoint} hidden={!left} className="flex flex-col gap-3">
            <h2 className="label m-0 text-muted-foreground">{g.checkpoint} <span className="font-normal">· {left}</span></h2>
            {g.items.map((i) => (
              <DecisionCard key={i.id} item={{ ...i, product: multi ? i.product.name : undefined }} admin={admin} onDecided={(id) => setGone((x) => [...x, id])} onFailed={(id) => setGone((x) => x.filter((y) => y !== id))} />
            ))}
          </section>
        )
      })}
    </div>
  )
}
