"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { codeScroll, codeSurface, mono, paper } from "./surfaces";
import type { DiffLine } from "./code-diff";

export interface DiffHunk {
  id: string;
  range: string;
  lines: readonly DiffLine[];
}

const GUTTER = { context: "", added: "+", removed: "−" } as const;

// From `elements-reviewable-diff`, read-only: one hunk per changed section. The registry's keep/discard per hunk and "Apply" footer are not used: the engine applies a
// turn's Ticket text whole or not at all, so there is nothing to keep or discard per hunk (the person changes the text by talking to the conversation).
export function ReviewableDiff({ filename, hunks, className, ...props }: Omit<ComponentProps<"div">, "children"> & { filename: string; hunks: readonly DiffHunk[] }) {
  return (
    <div data-slot="reviewable-diff" className={cn(paper, "flex w-full flex-col overflow-hidden", className)} {...props}>
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-[13px] font-medium">{filename}</span>
        <span className={cn(mono, "text-muted-foreground tabular-nums")}>{hunks.length} changed</span>
      </div>
      {hunks.map((hunk) => (
        <div key={hunk.id} data-testid="diff-hunk" className="border-t border-border">
          <div className={cn(mono, "px-4 py-1.5 text-muted-foreground")}>{hunk.range}</div>
          <div className={cn(codeScroll, "pb-1.5 font-mono text-xs")}>
            <div className={codeSurface}>
              {hunk.lines.map((line, i) => (
                <div key={`${hunk.id}-${i}`} className={cn("flex px-4 py-0.5 leading-relaxed whitespace-pre", line.kind === "context" && "text-muted-foreground", line.kind === "added" && "bg-ok/10 text-ok", line.kind === "removed" && "bg-destructive/10 text-destructive")}>
                  <span className="w-4 shrink-0 select-none">{GUTTER[line.kind]}</span>
                  <span>{line.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
