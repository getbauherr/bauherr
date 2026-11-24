import type { ComponentProps } from "react";
import type { useReceiptFocus } from "./receipt-focus";

export interface OptionListOption {
  id: string;
  label: string;
  description?: string | undefined;
  disabled?: boolean | undefined;
}

export interface OptionListProps extends Omit<
  ComponentProps<"div">,
  "children" | "defaultValue" | "onChange"
> {
  options: readonly OptionListOption[];
  selectionMode?: "single" | "multiple" | undefined;
  defaultValue?: readonly string[] | undefined;
  minSelections?: number | undefined;
  maxSelections?: number | undefined;
  onConfirm?: ((ids: string[]) => void | Promise<void>) | undefined;
  confirmLabel?: string | undefined;
  choice?: readonly string[] | undefined;
}


export type FocusHandlers = ReturnType<typeof useReceiptFocus>["focusHandlers"];

export type DomProps = Omit<
  OptionListProps,
  | "options"
  | "selectionMode"
  | "defaultValue"
  | "minSelections"
  | "maxSelections"
  | "onConfirm"
  | "confirmLabel"
  | "choice"
>;

