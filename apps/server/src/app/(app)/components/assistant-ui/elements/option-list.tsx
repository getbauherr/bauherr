"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { paper } from "./surfaces";
import {
  InteractiveView,
  useListShell,
  ReceiptView,
  StaticView,
} from "./option-list-views";
import type { OptionListProps } from "./option-list-types";

export type { OptionListOption, OptionListProps } from "./option-list-types";

export function OptionList({
  options,
  selectionMode,
  defaultValue,
  minSelections,
  maxSelections,
  onConfirm,
  confirmLabel,
  choice,
  className,
  ...domProps
}: OptionListProps) {
  const [confirmed, setConfirmed] = useState<readonly string[] | undefined>();
  const { focusHandlers, setReceiptRef } = useListShell(domProps);
  const root = cn(
    paper,
    "flex w-full max-w-sm flex-col gap-1 rounded-2xl p-2",
    className,
  );
  const confirmedChoice = choice ?? confirmed;

  if (confirmedChoice !== undefined) {
    const chosen = options.filter((option) =>
      confirmedChoice.includes(option.id),
    );
    return (
      <ReceiptView
        chosen={chosen}
        root={root}
        domProps={domProps}
        focusHandlers={focusHandlers}
        setReceiptRef={setReceiptRef}
      />
    );
  }
  if (!onConfirm) {
    return (
      <StaticView
        options={options}
        root={root}
        domProps={domProps}
        focusHandlers={focusHandlers}
      />
    );
  }
  return (
    <InteractiveView
      options={options}
      selectionMode={selectionMode}
      defaultValue={defaultValue}
      minSelections={minSelections}
      maxSelections={maxSelections}
      confirmLabel={confirmLabel}
      onConfirm={onConfirm}
      onConfirmed={setConfirmed}
      root={root}
      domProps={domProps}
      focusHandlers={focusHandlers}
    />
  );
}

