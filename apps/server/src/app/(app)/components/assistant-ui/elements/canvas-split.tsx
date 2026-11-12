"use client";

import type { ComponentProps } from "react";
import { FileTextIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { mono } from "./surfaces";

// From `elements-canvas-split`: the document half only (the thread half is the conversation shell's chat column). The header takes the version as text
// and the page's actions as children instead of the registry's copy and close buttons.
export function CanvasSplitDocument({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="canvas-split-document" className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)} {...props} />;
}

export function CanvasSplitHeader({
  title,
  version,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "title"> & { title: string; version: string }) {
  return (
    <div data-slot="canvas-split-header" className={cn("flex min-h-[52px] items-center gap-2 border-b border-border px-5 py-2", className)} {...props}>
      <FileTextIcon className="size-4 shrink-0 text-foreground" />
      <span className="min-w-0 truncate text-[14px] font-semibold">{title}</span>
      <span data-testid="artifact-version" className={cn(mono, "shrink-0 rounded-full border border-border px-2 py-0.5 text-muted-foreground")}>{version}</span>
      <span className="ms-auto flex shrink-0 items-center gap-1">{children}</span>
    </div>
  );
}

export function CanvasSplitBody({ writing, className, children, ...props }: ComponentProps<"div"> & { writing?: boolean }) {
  return (
    <div data-slot="canvas-split-body" className={cn("flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-5 py-4", className)} {...props}>
      {children}
      {writing && <span aria-hidden className="h-[1.05em] w-[2px] animate-pulse rounded-full bg-foreground/70 motion-reduce:animate-none" />}
    </div>
  );
}
