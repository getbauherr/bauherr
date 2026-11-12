"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { paper } from "./surfaces";

// From `elements-agent-card`: who you are talking to. The registry's skill list and "Connect" button are not used (nothing to connect to here): the card shows the role's
// avatar and profile line, then the executor's facts as rows (`facts`) and a footer slot (`children`).
export function AgentCard({
  avatar,
  name,
  description,
  facts,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "children" | "name"> & { avatar: ReactNode; name: string; description: string; facts: readonly { label: string; value: ReactNode }[]; children?: ReactNode }) {
  return (
    <div data-slot="agent-card" className={cn(paper, "flex w-full flex-col gap-3 p-4", className)} {...props}>
      <div className="flex items-start gap-3">
        {avatar}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] font-semibold">{name}</span>
          {description && <span className="text-[13px] leading-5 text-muted-foreground">{description}</span>}
        </div>
      </div>
      <dl className="m-0 flex flex-col gap-1.5 border-t border-border pt-3">
        {facts.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-4 text-[13px]">
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className="m-0 min-w-0 truncate text-right">{f.value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </div>
  );
}
