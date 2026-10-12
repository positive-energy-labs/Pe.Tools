/**
 * PEA'S TAKEOFF PROPOSALS, in the band grammar (the takeoffs cutover). Every family — room edits,
 * adoption choices, flag verdicts, review flags — is a record of trichotomy cells; a proposal is
 * drawn through the kit (`ReviewRow` / `StateCell`, verbs from `availableTransitions`), so accept
 * stages it and deny clears it exactly as on every other route. No second grammar.
 */
import {
  sameValue,
  takeoffEditKey,
  type RoomEditField,
  type TrichotomyCellLike,
} from "@pe/agent-contracts";
import type { ReactNode } from "react";

import { ReviewRow, reviewTransitions, type CellWire } from "#/components/lang/band";
import { cellFromTrichotomy, fmtNum, StateCell } from "#/components/lang/cell";
import { useCellNavigation } from "#/components/master-table/cell-navigation";

/** An adoption choice said as the person reads it. */
export const showAdopt = (value: unknown) => {
  const choice = (value ?? {}) as { checked?: boolean; name?: string; systemTag?: string };
  return [
    choice.checked === false ? "not adopted" : "adopt",
    choice.name ? `as ${choice.name}` : null,
    choice.systemTag ? `· ${choice.systemTag}` : null,
  ]
    .filter(Boolean)
    .join(" ");
};

/** The shape a review-flag key names: `[zoneKey, shapeKey]`. */
export const flagShape = (key: string) => (JSON.parse(key) as [string, string])[1];
export const flagZone = (key: string) => (JSON.parse(key) as [string, string])[0];

/** A cell Pea is arguing for: a proposal that is not what is staged. */
const proposing = (cell: TrichotomyCellLike | undefined) =>
  cell?.proposal != null && !sameValue(cell.proposal, cell.staged);

/** One review row per proposing cell whose key passes `keep`; nothing when none. */
export function TakeoffProposalRows({
  cells,
  wire,
  keep = () => true,
  label,
  show,
}: {
  cells: Readonly<Record<string, TrichotomyCellLike>>;
  wire: CellWire;
  keep?: (key: string) => boolean;
  /** The row's label for a key ("name", "flag seedless", "shape 3"). */
  label: (key: string) => ReactNode;
  show: (value: unknown) => string;
}) {
  const rows = Object.entries(cells).filter(([key, cell]) => keep(key) && proposing(cell));
  if (!rows.length) return null;
  return (
    <div data-slot="takeoff-proposals" className="flex flex-col">
      {rows.map(([key, cell]) => (
        <ReviewRow
          key={key}
          wire={wire}
          address={key}
          label={<span className="t-small face-mono text-ink-2">pea proposes · {label(key)}</span>}
          cell={cell}
          facts={{ value: show((cell.staged ?? cell.proposal)?.value), scale: "row" }}
          show={show}
        />
      ))}
    </div>
  );
}

/**
 * One room field as a trichotomy cell: the staged world's value, or Pea's proposed value with its
 * fold while only proposed; its verbs are the contract's; typing stages (through `onPatch`).
 */
export function TakeoffEditCell({
  roomId,
  field,
  value,
  digits,
  integer = false,
  cell,
  wire,
  onPatch,
}: {
  roomId: string;
  field: RoomEditField;
  value: number;
  digits: number;
  integer?: boolean;
  cell: TrichotomyCellLike | undefined;
  wire: CellWire;
  onPatch: (value: number) => void;
}) {
  const move = useCellNavigation();
  const key = takeoffEditKey(roomId, field);
  const show = (raw: unknown) => fmtNum(Number(raw), digits);
  const shown =
    cell?.staged == null && cell?.proposal != null ? Number(cell.proposal.value) : value;
  return (
    <StateCell
      {...cellFromTrichotomy(
        cell ?? { proposal: null, staged: null },
        {
          value: show(shown),
          currentValue: show(value),
          scale: "row",
          numeric: { integer, min: 0, digits },
        },
        show,
      )}
      transitions={cell ? reviewTransitions(wire, key, cell) : undefined}
      onCommit={(text) => onPatch(Number(text))}
      onNavigate={(direction) => move?.(direction) ?? false}
    />
  );
}
