import { type CellLike } from "@pe/agent-contracts";
import { cellFromDraft, StateCell, type CellOption, type CellTransition } from "@pe/kit/lang/cell";

export type CellPath =
  | readonly ["criteria"]
  | readonly ["rules" | "ruleAssignments" | "kinds" | "parameters" | "roles", string];
export type CellAct = (
  path: CellPath,
  cell: CellLike,
  kind: "clear",
  label: string,
) => Promise<{ code: string; message: string } | null>;

export function ChoiceCell({
  label,
  options,
  current,
  cell,
  path,
  show,
  refusal,
  pick,
  act,
}: {
  label: string;
  options: readonly CellOption[];
  /** The option key standing now (the edit, or the source underneath). */
  current: string | null;

  cell: CellLike | undefined;
  /** That cell's path in the route document, `[segment, key]`. */
  path: CellPath | null;
  /** A Work rung value as the option label it names. */
  show: (value: unknown) => string;
  refusal: string | null;
  pick: (key: string) => void;
  act?: CellAct;
}) {
  const shown = options.find((o) => o.key === current)?.label ?? current ?? "—";
  // A stale edit: the standing option is now disabled. It stays the shown value, with its reason
  // as the cell's warning; the row's clear verb is the way out.
  const stale = options.find((o) => o.key === current)?.disabled ?? null;
  const drawn = cellFromDraft(
    cell ?? {},
    refusal
      ? { value: shown, cap: "locked", capReason: refusal }
      : { value: shown, ...(stale ? { damage: stale } : {}) },
    show,
  );
  const transitions: CellTransition[] =
    cell && path && act && !refusal
      ? cell.edit != null
        ? [{ kind: "clear", run: () => act(path, cell, "clear", label) }]
        : []
      : [];
  return (
    <span className="block min-w-0" data-choice-cell={label}>
      <StateCell
        {...drawn}
        scale="row"
        choice={{ options, current, pick: (key) => void pick(key) }}
        transitions={transitions}
      />
    </span>
  );
}
