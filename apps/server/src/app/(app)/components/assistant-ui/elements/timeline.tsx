"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { mono, paper } from "./surfaces";
import { take } from "../utils/range";

export type TimelineWhen = "past" | "now" | "future";

export interface TimelineEvent {
  id: string;
  when: TimelineWhen;
  time: string;
  title: string;
  detail?: string;
  body?: ReactNode;
}

const dotClass = (when: TimelineWhen) =>
  cn(
    "mt-1 size-2 shrink-0 rounded-full",
    when === "now" &&
      "bg-primary ring-4 ring-primary/15 forced-colors:bg-[Highlight]",
    when === "past" && "bg-muted-foreground forced-colors:bg-[CanvasText]",
    when === "future" && "border-muted-foreground border bg-transparent",
  );

function Rail({ when, last }: { when: TimelineWhen; last: boolean }) {
  return (
    <span className="flex flex-col items-center">
      <span className={dotClass(when)} />
      {!last && (
        <span
          className={cn(
            "w-px flex-1",
            when === "future" ? "bg-foreground/[0.08]" : "bg-foreground/15",
          )}
        />
      )}
    </span>
  );
}

function TimelineRow({
  event,
  last,
}: {
  event: TimelineEvent;
  last: boolean;
}) {
  return (
    <div
      className={cn(
        "fade-in slide-in-from-left-1 animate-in fill-mode-both grid",
        "grid-cols-[3.5rem_1rem_minmax(0,1fr)] gap-x-2 duration-300",
      )}
    >
      <span
        className={cn(
          mono,
          "text-muted-foreground pt-[3px] text-end tabular-nums",
        )}
      >
        {event.time}
      </span>

      <Rail when={event.when} last={last} />

      <div className={cn("flex flex-col gap-0.5", !last && "pb-3")}>
        <span
          className={cn(
            "text-[13px] break-words",
            event.when === "future"
              ? "text-muted-foreground"
              : "text-foreground/90",
            event.when === "now" && "font-medium",
          )}
        >
          {event.title}
        </span>
        {event.body}
        {event.detail && (
          <span
            className={cn(
              "text-muted-foreground text-xs leading-relaxed break-words",
            )}
          >
            {event.detail}
          </span>
        )}
      </div>
    </div>
  );
}

export function Timeline({
  events,
  visibleCount,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "events" | "visibleCount"> & {
  events: readonly TimelineEvent[];
  visibleCount: number;
}) {
  return (
    <div
      data-slot="timeline"
      className={cn(
        paper,
        "flex w-full max-w-sm flex-col rounded-2xl p-4",
        className,
      )}
      {...props}
    >
      {take(events, visibleCount).map((event, i, shown) => (
        <TimelineRow key={event.id} event={event} last={i === shown.length - 1} />
      ))}
    </div>
  );
}
