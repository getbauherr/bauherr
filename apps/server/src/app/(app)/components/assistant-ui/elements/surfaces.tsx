import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Shared class strings of the copied assistant-ui elements, mapped to the app's tokens (same border, radius and colours as `ui/card` and `ui/button`).
export const paper = "rounded-md border border-border bg-card text-card-foreground";

export const field = "border border-border bg-background";

export const ghostButton =
  "flex items-center justify-center rounded-md text-muted-foreground outline-hidden transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/** The app's primary button colours (never the registry's black pill). */
export const inkButton = "bg-primary text-primary-foreground transition-opacity hover:opacity-90";

export const iconSwap = "[grid-area:1/1] transition-[opacity,scale] duration-200 motion-reduce:transition-none";

export const iconSwapIn = "scale-100 opacity-100";

export const iconSwapOut = "scale-[0.25] opacity-0";

export const mono = "font-mono text-[11px] tracking-tight";

export function ShimmerLabel({ active = true, className, ...props }: ComponentProps<"span"> & { active?: boolean }) {
  return <span className={cn(active && "animate-pulse motion-reduce:animate-none", className)} {...props} />;
}

/** Scroll region for rows that keep their whitespace; `codeSurface` wraps all rows as one block. */
export const codeScroll = "overflow-x-auto";

export const codeSurface = "w-max min-w-full";
