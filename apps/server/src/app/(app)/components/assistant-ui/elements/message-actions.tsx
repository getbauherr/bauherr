"use client";

import type { ComponentProps } from "react";
import { CheckIcon, CopyIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ghostButton, iconSwap, iconSwapIn, iconSwapOut } from "./surfaces";

export type Reaction = "up" | "down" | null;

// From `elements-message-actions`: copy and the two thumbs. The registry's regenerate and "more" buttons are not used (a refinement turn cannot be replayed: it changed the Ticket).
export function MessageActions({ copied, reaction, onCopy, onReactionChange, className, ...props }: Omit<ComponentProps<"div">, "children"> & { copied: boolean; reaction: Reaction; onCopy: () => void; onReactionChange: (reaction: Reaction) => void }) {
  const button = cn(ghostButton, "size-7");
  const on = "bg-secondary text-foreground";
  return (
    <div data-slot="message-actions" data-testid="rate" className={cn("flex items-center gap-1", className)} {...props}>
      <button type="button" aria-label={copied ? "Copied" : "Copy"} onClick={onCopy} className={cn(button, "grid place-items-center", copied && "text-ok")}>
        <CopyIcon className={cn(iconSwap, "size-3.5", copied ? iconSwapOut : iconSwapIn)} />
        <CheckIcon className={cn(iconSwap, "size-3.5", copied ? iconSwapIn : iconSwapOut)} />
      </button>
      <button type="button" aria-label="Good answer" title="Good answer" aria-pressed={reaction === "up"} onClick={() => onReactionChange(reaction === "up" ? null : "up")} className={cn(button, reaction === "up" && on)}>
        <ThumbsUpIcon className="size-3.5" />
      </button>
      <button type="button" aria-label="Bad answer" title="Bad answer" aria-pressed={reaction === "down"} onClick={() => onReactionChange("down")} className={cn(button, reaction === "down" && on)}>
        <ThumbsDownIcon className="size-3.5" />
      </button>
    </div>
  );
}
