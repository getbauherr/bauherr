"use client";

import { Children, type ComponentProps, type ReactNode, useState } from "react";
import {
  Ban,
  CheckIcon,
  ChevronRightIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { mono, paper } from "./surfaces";

export type TaskCardState =
  | "working"
  | "waiting"
  | "done"
  | "failed"
  | "cancelled";

const isRenderable = (node: ReactNode) =>
  node !== undefined && node !== null && node !== false && node !== true;

export function TaskStateIcon({
  state,
  className,
}: {
  state: TaskCardState;
  className?: string;
}) {
  if (state === "done") {
    return (
      <CheckIcon
        aria-hidden
        className={cn("size-3.5 shrink-0 text-ok", className)}
      />
    );
  }
  if (state === "failed") {
    return (
      <XIcon
        aria-hidden
        className={cn("text-destructive size-3.5 shrink-0", className)}
      />
    );
  }
  if (state === "cancelled") {
    return (
      <Ban
        aria-hidden
        className={cn("text-muted-foreground size-3.5 shrink-0", className)}
      />
    );
  }
  if (state === "working") {
    return (
      <Loader2Icon
        aria-hidden
        className={cn(
          "text-muted-foreground size-3.5 shrink-0 animate-spin",
          "motion-reduce:animate-none",
          className,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "border-foreground/35 m-1 size-1.5 shrink-0 rounded-full border",
        className,
      )}
    />
  );
}

const sectionBorder = "border-border/60 border-t";

function TaskCardHeader({
  label,
  meta,
  state,
  elapsed,
  expandable,
  isOpen,
  disabled,
  onToggle,
}: {
  label: string;
  meta: string | undefined;
  state: TaskCardState;
  elapsed: string | undefined;
  expandable: boolean;
  isOpen: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expandable ? isOpen : undefined}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "hover:enabled:bg-foreground/[0.03] flex items-center gap-2.5 px-3.5",
        "py-2.5 text-start transition-colors disabled:cursor-default",
      )}
    >
      <TaskStateIcon state={state} />
      <span className="sr-only">{state}</span>
      <span className="min-w-0 flex-1 truncate text-[13.5px]">{label}</span>
      {meta !== undefined && (
        <span
          className={cn(mono, "text-muted-foreground max-w-24 shrink-0 truncate")}
        >
          {meta}
        </span>
      )}
      {elapsed !== undefined && (
        <span
          className={cn(mono, "text-muted-foreground shrink-0 tabular-nums")}
        >
          {elapsed}
        </span>
      )}
      {expandable && (
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "text-muted-foreground size-3 shrink-0 transition-transform",
            "duration-200 motion-reduce:transition-none",
            isOpen && "rotate-90",
          )}
        />
      )}
    </button>
  );
}

function useTaskOpen(
  open: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  return { isOpen, toggle };
}

type TaskCardProps = Omit<
  ComponentProps<"div">,
  "children" | "label" | "state" | "result" | "open" | "onOpenChange"
> & {
  label: string;
  meta?: string | undefined;
  state: TaskCardState;
  elapsed?: string | undefined;
  actions?: ReactNode | undefined;
  result?: ReactNode | undefined;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  children?: ReactNode | undefined;
};

function TaskCardSections({
  actions,
  result,
  transcript,
}: {
  actions: ReactNode;
  result: ReactNode;
  transcript: ReactNode;
}) {
  return (
    <>
      {isRenderable(actions) && (
        <div
          data-slot="task-card-actions"
          className={cn(sectionBorder, "px-3.5 py-2.5")}
        >
          {actions}
        </div>
      )}
      {isRenderable(transcript) && (
        <div
          data-slot="task-card-transcript"
          className={cn(sectionBorder, "flex flex-col gap-2 px-3.5 py-2.5")}
        >
          {transcript}
        </div>
      )}
      {isRenderable(result) && (
        <div
          data-slot="task-card-result"
          className={cn(
            sectionBorder,
            "text-foreground/70 px-3.5 py-2 text-xs leading-relaxed",
          )}
        >
          {result}
        </div>
      )}
    </>
  );
}

export function TaskCard({
  label,
  meta,
  state,
  elapsed,
  actions,
  result,
  open,
  onOpenChange,
  children,
  className,
  ...props
}: TaskCardProps) {
  const hasTranscript = Children.toArray(children).length > 0;
  const inert = open !== undefined && onOpenChange === undefined;
  const { isOpen, toggle } = useTaskOpen(open, onOpenChange);

  return (
    <div
      data-slot="task-card"
      data-state={state}
      className={cn(
        paper,
        "flex w-full max-w-sm flex-col overflow-hidden rounded-2xl",
        className,
      )}
      {...props}
    >
      <TaskCardHeader
        label={label}
        meta={meta}
        state={state}
        elapsed={elapsed}
        expandable={hasTranscript}
        isOpen={isOpen}
        disabled={!hasTranscript || inert}
        onToggle={toggle}
      />
      <TaskCardSections
        actions={actions}
        result={result}
        transcript={hasTranscript && isOpen ? children : undefined}
      />
    </div>
  );
}
