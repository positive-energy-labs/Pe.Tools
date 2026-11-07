import type { CellLike } from "@pe/agent-contracts";
import {
  cellFromDraft,
  type CellOption,
  type CellTransition,
  type StateCellProps,
} from "./cell-state";
import type { ValueHandle } from "./value";

/** Structural draw handle; kit neither acquires Work nor sends writes. */
export interface CellHandle {
  readonly facts?: Pick<HandleCellProps, "model" | "source" | "options" | "parse" | "format"> & { baseline?: unknown; readOnly?: boolean };
  readonly freshness?: "current" | "stale" | "never";
  readonly owner: { route: string; label: string };
  readonly value: CellLike;
  readonly refusal: string | null;
  transitions(history?: { label: string }): CellTransition[];
  stage(value: unknown, history?: { label: string }): Promise<{ message: string } | null>;
  clear(history?: { label: string }): Promise<{ message: string } | null>;
}

export interface HandleCellProps extends Omit<
  Extract<StateCellProps, { onCommit?: unknown }>,
  "value" | "onCommit" | "transitions" | "choice" | "measured"
> {
  cell: CellHandle;
  value?: ValueHandle<unknown>;
  label: string;
  model?: unknown;
  source?: string;
  format?: (value: unknown) => string;
  parse?: (text: string) => unknown;
  options?: readonly (CellOption & {
    value?: unknown;
    clear?: boolean;
    history?: { label: string };
  })[];
  keyOf?: string | ((value: unknown) => string);
  /** A semantic option key when the stored value has a different identity. */
  current?: string | null;
}

export const cellSource = (cell: CellHandle, source = "model") =>
  cell.value.edit ? cell.owner.label : source;

/** The same projection feeds StateCell and table state/facets/readouts. */
export function handleCellProps({
  cell,
  value: reading,
  label,
  model,
  source = "model",
  format = String,
  parse,
  options,
  keyOf = String,
  current,
  ...facts
}: HandleCellProps): StateCellProps {
  model ??= cell.facts?.model;
  options ??= cell.facts?.options;
  parse ??= cell.facts?.parse;
  format = cell.facts?.format ?? format;
  source = cell.facts?.source ?? source;
  const value = cell.value.edit ? cell.value.edit.value : model;
  const readKey =
    typeof keyOf === "string"
      ? (value: unknown) =>
          value && typeof value === "object" && keyOf in value
            ? String((value as Record<string, unknown>)[keyOf])
            : null
      : keyOf;
  const key = current === undefined ? (value == null ? null : readKey(value)) : current;
  const option = options?.find((option) => option.key === key);
  const history = { label };
  const reason =
    cell.refusal ??
    (reading && !reading.current
      ? (reading.reason ?? "Read the current Value before editing")
      : null) ??
    facts.capReason;
  const note = [
    facts.note ?? cell.value.edit?.note,
    cellSource(cell, source),
    cell.owner.label.startsWith("from /") && !cell.value.edit ? cell.owner.label : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const drawn = cellFromDraft(cell.value, {
    ...facts,
    fresh: cell.freshness && cell.freshness !== "current" ? cell.freshness :
      reading && !reading.current ? (reading.value === undefined ? "never" : "stale") : facts.fresh,
    value: options
      ? (option?.label ?? (value == null ? "—" : format(value)))
      : value == null
        ? "—"
        : format(value),
    modelValue: model == null ? undefined : format(model),
    note,
    ...(option?.disabled ? { damage: option.disabled } : {}),
    ...(reason ? { cap: "locked", capReason: reason } : {}),
  });
  const transitions = reason ? [] : cell.transitions(history);
  return options
    ? {
        ...drawn,
        scale: "row",
        transitions,
        choice: {
          options,
          current: key,
          pick: async (key) => {
            const option = options.find((option) => option.key === key);
            if (!option || option.disabled) return;
            return option.clear
              ? cell.clear(option.history ?? history)
              : cell.stage(
                  option.value === undefined ? key : option.value,
                  option.history ?? history,
                );
          },
        },
      }
    : {
        ...drawn,
        scale: facts.scale ?? "row",
        transitions,
        onCommit: cell.facts?.readOnly ? undefined : async (text) =>
          cell.stage(parse ? parse(text) : facts.numeric ? Number(text) : text, history),
      };
}
