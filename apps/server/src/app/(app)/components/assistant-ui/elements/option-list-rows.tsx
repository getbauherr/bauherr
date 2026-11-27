"use client";

import { CheckIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import { inkButton, mono } from "./surfaces";
import type { OptionListOption } from "./option-list-types";
import type { Selection } from "./option-list-selection";

export const row = [
  "flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-start",
  "transition-colors outline-none focus-visible:ring-1",
  "focus-visible:ring-foreground/20",
].join(" ");

export const indicatorSlot = "flex h-5 w-3.5 shrink-0 items-center justify-center";

export function OptionText({ option }: { option: OptionListOption }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-[13.5px] leading-5 break-words">
        {option.label}
      </span>
      {option.description ? (
        <span className="text-muted-foreground text-xs leading-4 break-words">
          {option.description}
        </span>
      ) : null}
    </span>
  );
}


function RowIndicator({
  multiple,
  isSelected,
  isPending,
}: {
  multiple: boolean;
  isSelected: boolean;
  isPending: boolean;
}) {
  if (multiple) {
    return (
      <span aria-hidden className={indicatorSlot}>
        <span
          className={cn(
            "flex size-3.5 items-center justify-center rounded-[5px] border",
            "transition-colors",
            isSelected
              ? "border-primary bg-primary"
              : "border-foreground/15",
          )}
        >
          {isSelected ? (
            <CheckIcon
              className={cn(
                "fade-in zoom-in-90 animate-in text-primary-foreground size-2.5",
                "duration-200 motion-reduce:animate-none",
              )}
            />
          ) : null}
        </span>
      </span>
    );
  }
  if (!isPending) return null;
  return (
    <span aria-hidden className={indicatorSlot}>
      <Loader2Icon
        className={cn(
          "text-muted-foreground size-3.5 animate-spin",
          "motion-reduce:animate-none",
        )}
      />
    </span>
  );
}

const rowClass = (isSelected: boolean, unavailable: boolean, idle: boolean) =>
  cn(
    row,
    isSelected ? "bg-foreground/[0.06]" : idle && "hover:bg-foreground/[0.035]",
    unavailable ? "text-muted-foreground" : "text-foreground/90",
    !idle && "cursor-default",
  );

const rowState = (
  option: OptionListOption,
  multiple: boolean,
  selection: Selection,
) => {
  const { count, max, selectedIds, selected, pending } = selection;
  const isSelected = multiple
    ? selectedIds.includes(option.id)
    : (pending ?? selected).includes(option.id);
  const unavailable =
    option.disabled === true || (multiple && !isSelected && count >= max);
  return { isSelected, unavailable };
};

export function OptionRow({
  option,
  multiple,
  selection,
}: {
  option: OptionListOption;
  multiple: boolean;
  selection: Selection;
}) {
  const { isSelected, unavailable } = rowState(option, multiple, selection);
  const { locked, pending } = selection;
  const onClick = () => {
    if (unavailable) return;
    if (multiple) selection.toggle(option.id);
    else selection.commit([option.id]);
  };
  return (
    <button
      type="button"
      {...(multiple ? { role: "checkbox", "aria-checked": isSelected } : {})}
      aria-disabled={unavailable || locked || undefined}
      disabled={option.disabled}
      onClick={onClick}
      className={rowClass(isSelected, unavailable, !unavailable && !locked)}
    >
      <RowIndicator
        multiple={multiple}
        isSelected={isSelected}
        isPending={pending?.includes(option.id) === true}
      />
      <OptionText option={option} />
    </button>
  );
}

export function ConfirmBar({
  options,
  selection,
  confirmLabel,
}: {
  options: readonly OptionListOption[];
  selection: Selection;
  confirmLabel: string;
}) {
  const { count, max, canConfirm, locked, selectedIds } = selection;
  const onClick = () => {
    if (!canConfirm) return;
    selection.commit(
      options
        .filter((option) => selectedIds.includes(option.id))
        .map((option) => option.id),
    );
  };
  return (
    <div className="flex items-center justify-between gap-3 px-2 pt-1.5 pb-1">
      <span className={cn(mono, "text-muted-foreground tabular-nums")}>
        {count} of {max}
      </span>
      <button
        type="button"
        aria-disabled={!canConfirm || undefined}
        onClick={onClick}
        className={cn(
          inkButton,
          "flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs",
          "font-medium",
          !canConfirm && "cursor-default opacity-40 hover:opacity-40",
        )}
      >
        {locked ? (
          <Loader2Icon
            aria-hidden
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
        ) : null}
        {confirmLabel}
      </button>
    </div>
  );
}

