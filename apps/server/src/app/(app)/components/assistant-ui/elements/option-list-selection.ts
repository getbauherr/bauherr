import { useState } from "react";
import { clamp } from "../utils/range";
import type { OptionListOption } from "./option-list-types";

export type SelectionConfig = {
  options: readonly OptionListOption[];
  defaultValue: readonly string[] | undefined;
  minSelections: number;
  maxSelections: number | undefined;
  onConfirm: (ids: string[]) => void | Promise<void>;
  onConfirmed: (ids: readonly string[]) => void;
};

export function useOptionSelection({
  options,
  defaultValue,
  minSelections,
  maxSelections,
  onConfirm,
  onConfirmed,
}: SelectionConfig) {
  const [selected, setSelected] = useState<readonly string[]>(() =>
    (defaultValue ?? []).filter((id) => options.some((o) => o.id === id)),
  );
  const [pending, setPending] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = pending !== null;
  const max = Math.floor(
    clamp(maxSelections ?? options.length, 0, options.length),
  );
  const min = Math.floor(clamp(minSelections, 0, max));
  const optionIds = new Set(options.map((option) => option.id));
  const selectedIds = selected.filter((id) => optionIds.has(id));

  const commit = (ids: string[]) => {
    if (locked) return;
    setPending(ids);
    setError(null);
    void (async () => {
      try {
        await onConfirm(ids);
        onConfirmed(ids);
      } catch (commitError) {
        setPending(null);
        setError(
          commitError instanceof Error
            ? commitError.message
            : String(commitError),
        );
      }
    })();
  };

  const toggle = (id: string) => {
    if (locked) return;
    setSelected((current) => {
      const available = current.filter((value) => optionIds.has(value));
      if (available.includes(id)) return available.filter((v) => v !== id);
      return available.length < max ? [...available, id] : available;
    });
  };

  const count = selectedIds.length;
  return {
    selected,
    selectedIds,
    pending,
    error,
    locked,
    max,
    count,
    canConfirm: !locked && count >= min && count <= max,
    commit,
    toggle,
  };
}

export type Selection = ReturnType<typeof useOptionSelection>;
