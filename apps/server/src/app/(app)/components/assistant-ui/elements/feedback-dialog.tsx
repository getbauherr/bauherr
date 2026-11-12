"use client";

import type { ComponentProps } from "react";
import { CheckIcon, ThumbsDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { mono, paper } from "./surfaces";

export function FeedbackDialog({
  reasons,
  selected,
  note,
  sent,
  onToggleReason,
  onNoteChange,
  onSubmit,
  className,
  ...props
}: Omit<
  ComponentProps<"div">,
  | "children"
  | "reasons"
  | "selected"
  | "note"
  | "sent"
  | "onToggleReason"
  | "onNoteChange"
  | "onSubmit"
> & {
  reasons: readonly string[];
  selected: readonly string[];
  note: string;
  sent: boolean;
  onToggleReason?: (reason: string) => void;
  onNoteChange?: (note: string) => void;
  onSubmit?: () => void;
}) {
  return (
    <div
      data-slot="feedback-dialog"
      className={cn(
        paper,
        "flex w-full rounded-md p-4",
        sent ? "items-center gap-2.5 text-[13.5px]" : "flex-col gap-3",
        className,
      )}

      {...props}
    >
      {/*
        Mounted whether or not the feedback has been sent, because a live region
        only announces a change that happens after it is already in the tree; a
        region created together with its text is the case AT is free to miss.
      */}
      <div
        role="status"
        className={
          sent
            ? "fade-in animate-in flex items-center gap-2.5 duration-300"
            : "sr-only"
        }
      >
        {sent && (
          <>
            <CheckIcon className="size-4 shrink-0 text-emerald-500" />
            Thanks. That helps us tune the model.
          </>
        )}
      </div>

      {sent ? null : (
        <>
          <div className="flex items-center gap-2.5">
            <span className="bg-secondary text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
              <ThumbsDownIcon className="size-3.5" />
            </span>
            <span className="text-[15px] font-medium">What went wrong?</span>
            <span className={cn(mono, "text-muted-foreground ms-auto")}>
              optional
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {reasons.map((reason) => {
              const active = selected.includes(reason);
              const className = cn(
                "rounded-md border px-2.5 py-1 text-xs transition-colors",
                                active
                  ? "border-primary bg-accent text-foreground"
                  : cn("border-border bg-card text-muted-foreground", onToggleReason && "hover:bg-secondary hover:text-foreground"),
              );
              return onToggleReason ? (
                <button
                  key={reason}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onToggleReason(reason)}
                  className={className}
                >
                  {reason}
                </button>
              ) : (
                <span
                  key={reason}
                  role="button"
                  aria-disabled="true"
                  aria-pressed={active}
                  className={className}
                >
                  {reason}
                </span>
              );
            })}
          </div>

          <textarea
            value={note}
            onChange={(event) => onNoteChange?.(event.target.value)}
            rows={2}
            placeholder="Anything else?"
            aria-label="Anything else?"
            className={"resize-none rounded-md border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"}
          />

          {onSubmit && (
            <Button type="button" size="sm" className="self-end" onClick={onSubmit}>
              Send
            </Button>
          )}
        </>
      )}
    </div>
  );
}
