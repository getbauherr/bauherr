"use client";

import type { ComponentProps, ReactNode } from "react";
import { CheckIcon, MinusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TodoStatus = "pending" | "active" | "done" | "cancelled";

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
  description?: string | undefined;
  /** Shown at the end of the row (the checklist's "Change"). */
  action?: ReactNode;
}

// From `elements-todo-list`: the open points as a checklist. Kept from the registry: the status icons, the done/total count and the screen-reader status; replaced: the spinner
// of an active item by a ring (the point is waiting for the person, nothing is running), the fold button by nothing (a Ticket has a handful of points), `action` is new.
export function TodoList({
  items,
  title,
  count,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "title"> & { items: readonly TodoItem[]; title: string; count: string }) {
  return (
    <div data-slot="todo-list" className={cn("flex w-full flex-col gap-2", className)} {...props}>
      <h3 className="m-0 flex items-baseline gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title} <span aria-hidden>·</span> <span data-testid="points-count">{count}</span>
      </h3>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {items.map((item) => (
          <li key={item.id} data-point={item.id} data-status={item.status} aria-current={item.status === "active" ? "step" : undefined} className={cn("flex items-start gap-3 rounded-md px-2 py-2 text-[14px]", item.status === "active" && "bg-accent")}>
            <span aria-hidden className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
              {item.status === "done" ? (
                <span className="flex size-4 items-center justify-center rounded-full bg-ok text-white"><CheckIcon className="size-3" strokeWidth={3} /></span>
              ) : item.status === "cancelled" ? (
                <span className="flex size-4 items-center justify-center rounded-full border border-border text-muted-foreground"><MinusIcon className="size-3" /></span>
              ) : item.status === "active" ? (
                <span className="flex size-4 items-center justify-center rounded-full border-2 border-primary"><span className="size-2 rounded-full bg-primary" /></span>
              ) : (
                <span className="size-4 rounded-full border border-muted-foreground/60" />
              )}
            </span>
            <span className="sr-only">{item.status}</span>
            <div className="min-w-0 flex-1 leading-5">
              <span className={cn("font-medium", item.status === "cancelled" && "text-muted-foreground line-through")}>{item.text}</span>
              {item.description && <p data-testid="point-answer" className="m-0 text-[13px] leading-5 text-muted-foreground wrap-anywhere">{item.description}</p>}
            </div>
            {item.action}
          </li>
        ))}
      </ul>
    </div>
  );
}
