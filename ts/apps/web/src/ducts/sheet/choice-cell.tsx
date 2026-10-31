/**
 * Every sheet dropdown is one kit choice cell over its Work cell (kaitpw 2026-10-30: "make a state
 * cell dropdown so it shares the same language … this needs to be something pea can propose for
 * u"). The cell draws the Work cell's state: a Pea suggestion on it draws proposed with Pea's
 * option, and take / unsuggest write the cell's own transition through the route's Work writer.
 * A pick goes through the sheet's edit (`pick`), so it lands in history with its effect.
 */
import { availableTransitions, type CellLike } from "@pe/agent-contracts";
import { cellFromDraft, StateCell, type CellOption, type CellTransition } from "@pe/kit/lang/cell";

/** Run one Pea-suggestion transition on a Work cell; resolves to a refusal, or null when it landed. */
export type CellAct = (
  path: readonly string[],
  cell: CellLike,
  kind: "take" | "unsuggest",
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
  /** The Work cell behind the choice, when it has one (a Pea suggestion lives here). */
  cell: CellLike | undefined;
  /** That cell's path in the route document, `[segment, key]`. */
  path: readonly string[] | null;
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
      ? availableTransitions(cell, { lock: null })
          .filter((kind): kind is "take" | "unsuggest" => kind === "take" || kind === "unsuggest")
          .map((kind) => ({ kind, run: () => act(path, cell, kind, label) }))
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
