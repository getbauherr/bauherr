"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { mono } from "./surfaces";

// From `elements-speaker-identity`, one turn at a time: the registry's icon square is the role's avatar (`avatar`), and the text is the message body (`children`, so a
// streaming reply keeps its own rendering). `name` is the role, `detail` its real executor.
export function SpeakerTurn({
  avatar,
  name,
  detail,
  meta,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "children"> & { avatar: ReactNode; name: string; detail?: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div data-slot="speaker-identity" className={cn("flex gap-3", className)} {...props}>
      <span className="mt-0.5 shrink-0">{avatar}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[14px] font-semibold">{name}</span>
          {detail && <span className="text-[13px] text-muted-foreground">{detail}</span>}
          {meta && <span className={cn(mono, "text-muted-foreground")}>{meta}</span>}
        </span>
        {children}
      </div>
    </div>
  );
}
