import { cn } from '@/lib/utils'
import { Badge } from '../../ui/badge'

export type TodoItem = { id: string; text: string; badge: string; done: boolean }

export function TodoList({ title, items }: { title: string; items: TodoItem[] }) {
  const done = items.filter((item) => item.done).length
  return (
    <section
      data-slot="todo-list"
      aria-label={title}
      className="grid gap-3 rounded-2xl border border-border bg-card p-4"
    >
      <h2 className="m-0 flex justify-between text-base font-semibold">
        {title}
        <span className="small text-muted-foreground" aria-label={`${done} of ${items.length}`}>
          {done}/{items.length}
        </span>
      </h2>
      {items.length === 0 ? (
        <p className="small m-0 text-muted-foreground">Nothing agreed yet. Accept a proposal or talk it through.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {items.map((item) => (
            <li key={item.id} className="grid gap-1">
              <span className={cn(item.done && 'line-through')}>{item.text}</span>
              <Badge className="w-fit">{item.badge}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
