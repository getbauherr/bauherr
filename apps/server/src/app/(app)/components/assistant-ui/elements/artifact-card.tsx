"use client";

import type { ComponentProps } from "react";
import { ArrowUpRightIcon, FileTextIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { mono, paper } from "./surfaces";

// From `elements-artifact-card`: the collapsed artifact in the stream; a click opens it again. A button (the registry's card is a div); the "Writing" shimmer is a pulse.
export function ArtifactCard({ title, meta, generating = false, className, ...props }: Omit<ComponentProps<"button">, "children" | "title"> & { title: string; meta: string; generating?: boolean }) {
  return (
    <button type="button" data-slot="artifact-card" className={cn(paper, "group flex w-full max-w-sm items-center gap-3 p-3 text-left transition-colors hover:bg-secondary", className)} {...props}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        <FileTextIcon className={cn("size-4", generating && "animate-pulse motion-reduce:animate-none")} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{title}</span>
        <span className={cn(mono, "block text-muted-foreground")}>{generating ? "Writing" : meta}</span>
      </span>
      <ArrowUpRightIcon className="size-3.5 text-muted-foreground" />
    </button>
  );
}
