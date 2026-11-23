import Link from 'next/link'
import type { TicketView } from '../../../../core/views/ticket'
import { Time } from '../Time'
import { Card } from './Section'

export function ActivityList({ events }: { events: TicketView['events'] }) {
  return (
    <Card bare>
      <ol className="m-0 grid list-none p-0">
        {events.map((event) => (
          <li
            key={event.id}
            className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-t border-border px-4 py-2 first:border-t-0"
          >
            <Time iso={event.at} className="mono text-muted-foreground" />
            <span>
              {event.label}
              {event.memories?.map((memory) => (
                <span key={memory.id} className="block">
                  <Link href={`/memory/${memory.id}`} className="text-primary hover:underline">
                    {memory.text}
                  </Link>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  )
}
