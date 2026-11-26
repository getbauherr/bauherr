import type { ComponentType } from 'react'
import type { AreaName } from '../../../../core/releases/notes-areas'
import type { NoteItem } from '../../../../core/releases/notes'
import { editNoteAction, removeNoteAction } from '../../(shell)/releases/actions'
import { Factory, MessageSquare, Memory, Pencil, Release, Settings, SquareCheck, Ticket } from '../icons'
import { Button } from '../ui/button'
import { NoteForm } from './NoteForm'

const AREA_LOOK: Record<AreaName, { Icon: ComponentType<{ className?: string }>; tone: string }> = {
  Memory: { Icon: Memory, tone: 'text-primary' },
  Tickets: { Icon: Ticket, tone: 'text-ok' },
  Products: { Icon: SquareCheck, tone: 'text-warn' },
  Releases: { Icon: Release, tone: 'text-primary' },
  Requests: { Icon: MessageSquare, tone: 'text-ok' },
  Settings: { Icon: Settings, tone: 'text-muted-foreground' },
  Factory: { Icon: Factory, tone: 'text-muted-foreground' },
}

const ROW =
  'grid grid-cols-[minmax(0,1fr)_1.5rem] gap-x-4 gap-y-1 border-t border-border py-2.5 first:border-t-0 ' +
  'sm:grid-cols-[8.5rem_minmax(0,1fr)_1.5rem]'

export function NoteRow({ item, product }: { item: NoteItem; product: number }) {
  const { Icon, tone } = AREA_LOOK[item.area]
  return (
    <li className={ROW}>
      <span className={`small col-span-2 inline-flex items-center gap-1.5 font-semibold sm:col-span-1 ${tone}`}>
        <Icon className="size-3.5" />
        {item.area}
      </span>
      <div className="grid gap-0.5">
        {item.title !== null && <span className="font-semibold">{item.title}</span>}
        <span className="small text-muted-foreground">{item.text}</span>
      </div>
      <details className="relative justify-self-end">
        <summary
          aria-label={`Edit ${item.title ?? item.text}`}
          className="list-none cursor-pointer text-muted-foreground [&::-webkit-details-marker]:hidden"
        >
          <Pencil className="size-4" />
        </summary>
        <div className="absolute right-0 z-10 mt-1 w-72">
          <NoteForm action={editNoteAction} product={product} draft={item} submit="Save">
            <Button type="submit" variant="outline" size="sm" formAction={removeNoteAction}>Remove</Button>
          </NoteForm>
        </div>
      </details>
    </li>
  )
}
