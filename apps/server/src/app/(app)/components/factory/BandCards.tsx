'use client'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { LaneMoreButton } from './LaneMoreButton'
import { useLaneMore, type LaneMore } from './useLaneMore'
import type { Item } from './useOrder'

export function BandCards({ items, more }: { items: Item<ReactNode>[]; more: LaneMore | undefined }) {
  const lane = useLaneMore(items, more)
  return (
    <>
      <ul className="m-0 grid list-none gap-2 p-0">
        {lane.all.map((item) => (
          <li key={item.id} className={cn(item.dimmed && 'opacity-20')}>
            {item.node}
          </li>
        ))}
      </ul>
      {lane.left > 0 && <LaneMoreButton left={lane.left} loading={lane.loading} load={lane.load} />}
    </>
  )
}
