"use client";

import { CheckIcon } from "lucide-react";
import { useCallback, type Ref } from "react";
import { cn } from "@/lib/utils";
import { mono } from "./surfaces";
import { useReceiptFocus } from "./receipt-focus";
import { useOptionSelection } from "./option-list-selection";
import {
  indicatorSlot,
  ConfirmBar,
  OptionRow,
  OptionText,
  row,
} from "./option-list-rows";
import type {
  DomProps,
  FocusHandlers,
  OptionListOption,
  OptionListProps,
} from "./option-list-types";

export const assignRef = (ref: Ref<HTMLDivElement> | undefined, node: HTMLDivElement | null) => {
  if (typeof ref === "function") return ref(node);
  if (ref && typeof ref === "object")
    (ref as { current: HTMLDivElement | null }).current = node;
  return undefined;
};

export function useListShell(domProps: DomProps) {
  const { receiptRef, focusHandlers } =
    useReceiptFocus<HTMLDivElement>(domProps);
  const setReceiptRef = useCallback(
    (node: HTMLDivElement | null) => {
      receiptRef.current = node;
      return assignRef(domProps.ref, node);
    },
    [domProps.ref, receiptRef],
  );
  return { focusHandlers, setReceiptRef };
}

export function ReceiptView({
  chosen,
  root,
  domProps,
  focusHandlers,
  setReceiptRef,
}: {
  chosen: readonly OptionListOption[];
  root: string;
  domProps: DomProps;
  focusHandlers: FocusHandlers;
  setReceiptRef: (node: HTMLDivElement | null) => void;
}) {
  return (
    <div
      data-slot="option-list"
      data-state="receipt"
      className={root}
      {...domProps}
      {...focusHandlers}
      ref={setReceiptRef}
      tabIndex={-1}
    >
      {chosen.length === 0 ? (
        <span className={cn(mono, "text-muted-foreground px-2 py-2")}>
          Nothing selected
        </span>
      ) : (
        chosen.map((option) => (
          <div key={option.id} className={cn(row, "text-foreground/70")}>
            <span className={indicatorSlot}>
              <CheckIcon
                aria-hidden
                className="text-muted-foreground size-3.5"
              />
              <span className="sr-only">Selected:</span>
            </span>
            <OptionText option={option} />
          </div>
        ))
      )}
    </div>
  );
}

export function StaticView({
  options,
  root,
  domProps,
  focusHandlers,
}: {
  options: readonly OptionListOption[];
  root: string;
  domProps: DomProps;
  focusHandlers: FocusHandlers;
}) {
  return (
    <div
      data-slot="option-list"
      className={root}
      {...domProps}
      {...focusHandlers}
    >
      {options.map((option) => (
        <div
          key={option.id}
          className={cn(row, option.disabled && "text-muted-foreground")}
        >
          <OptionText option={option} />
        </div>
      ))}
    </div>
  );
}


export type InteractiveProps = Pick<
  OptionListProps,
  "options" | "selectionMode" | "defaultValue" | "minSelections" | "maxSelections" | "confirmLabel"
> & {
  onConfirm: (ids: string[]) => void | Promise<void>;
  onConfirmed: (ids: readonly string[]) => void;
  root: string;
  domProps: DomProps;
  focusHandlers: FocusHandlers;
};

export function InteractiveView({
  options,
  selectionMode = "single",
  defaultValue,
  minSelections = 1,
  maxSelections,
  confirmLabel = "Confirm",
  onConfirm,
  onConfirmed,
  root,
  domProps,
  focusHandlers,
}: InteractiveProps) {
  const multiple = selectionMode === "multiple";
  const selection = useOptionSelection({
    options,
    defaultValue,
    minSelections,
    maxSelections,
    onConfirm,
    onConfirmed,
  });
  return (
    <div
      role="group"
      data-slot="option-list"
      data-state={selection.locked ? "pending" : "open"}
      aria-busy={selection.locked || undefined}
      className={root}
      {...domProps}
      {...focusHandlers}
    >
      {options.map((option) => (
        <OptionRow
          key={option.id}
          option={option}
          multiple={multiple}
          selection={selection}
        />
      ))}
      {selection.error ? (
        <p
          role="alert"
          className="px-2 pb-1 text-xs break-words text-danger "
        >
          {selection.error}
        </p>
      ) : null}
      {multiple ? (
        <ConfirmBar
          options={options}
          selection={selection}
          confirmLabel={confirmLabel}
        />
      ) : null}
    </div>
  );
}

