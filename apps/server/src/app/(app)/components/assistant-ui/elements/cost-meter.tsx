"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { mono, paper } from "./surfaces";
import { announced, pct } from "../utils/range";
import { formatTokenCount } from "../utils/tokens";

export interface CostLine {
  label: string;
  inputTokens: number;
  outputTokens: number;
  cost: string;
  share: number;
}

// From `elements-cost-meter`: total and a line per turn. The registry's "this run / session" pair is one `total` here, and a line's `label` is free (the turn and its model).
export function CostMeter({ total, tokens, lines, className, ...props }: Omit<ComponentProps<"div">, "children"> & { total: string; tokens: string; lines: readonly CostLine[] }) {
  return (
    <div data-slot="cost-meter" className={cn(paper, "flex w-full flex-col gap-3 p-4", className)} {...props}>
      <div className="flex items-baseline gap-2">
        <span data-testid="cost-total" className="text-2xl font-medium tracking-tight tabular-nums">{total}</span>
        <span className={cn(mono, "ms-auto tabular-nums text-muted-foreground")}>{tokens}</span>
      </div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        {lines.map((line) => {
          const width = pct(line.share, 1);
          if (announced(width) === 0) return null;
          return <span key={line.label} role="meter" aria-label={`${line.label} cost share`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={announced(width)} className="h-full bg-primary even:bg-primary/55" style={{ width: `${width}%` }} />;
        })}
      </div>
      <div className="flex flex-col gap-1.5">
        {lines.map((line) => (
          <div key={line.label} data-testid="cost-turn" className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="min-w-0 grow truncate text-[13px] text-foreground/80">{line.label}</span>
            <span className="ms-auto flex min-w-0 items-baseline gap-2">
              <span className={cn(mono, "truncate tabular-nums text-muted-foreground")}>{formatTokenCount(line.inputTokens)} in · {formatTokenCount(line.outputTokens)} out</span>
              <span className={cn(mono, "shrink-0 tabular-nums text-foreground/80")}>{line.cost}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
