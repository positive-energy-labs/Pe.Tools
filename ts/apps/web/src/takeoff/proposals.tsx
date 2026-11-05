import { takeoffEditKey, type RoomEditField, type CellLike } from "@pe/agent-contracts";
import type { ReactNode } from "react";

import { ReviewRow, reviewTransitions, type CellWire } from "#/components/work/band";
import { cellFromDraft, fmtNum, StateCell } from "@pe/kit/lang/cell";
import { useCellNavigation } from "@pe/kit/table/cell-navigation";
import { useTakeoffKernel } from "./kernel-context";
import type { TakeoffMount } from "./store";
import type { CellTransition } from "@pe/kit/lang/cell";

const transitions = (owner: TakeoffMount, segment: string | null, key: string): CellTransition[] =>
  ([["clear", "clear"]] as const).map(([kind, verb]) => {
    const control = owner.control(`cell:${segment}.${verb}`, { segment, key });
    return {
      kind,
      reason: control.refusal ?? control.label,
      run: async () => {
        const result = await control.run();
        return "refusal" in result ? result.refusal : null;
      },
    };
  });

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

const proposing = (cell: CellLike | undefined) => cell?.edit != null;

/** One review row per proposing cell whose key passes `keep`; nothing when none. */
export function TakeoffProposalRows({
  cells,
  wire,
  keep = () => true,
  label,
  show,
}: {
  cells: Readonly<Record<string, CellLike>>;
  wire: CellWire;
  keep?: (key: string) => boolean;
  /** The row's label for a key ("name", "flag seedless", "shape 3"). */
  label: (key: string) => ReactNode;
  show: (value: unknown) => string;
}) {
  const owner = useTakeoffKernel();
  const rows = Object.entries(cells).filter(([key, cell]) => keep(key) && proposing(cell));
  if (!rows.length) return null;
  return (
    <div data-slot="takeoff-proposals" className="flex flex-col">
      {rows.map(([key, cell]) =>
        owner ? (
          <div key={key} role="group" aria-label={`Staged ${key}`}>
            <span className="t-small face-mono text-ink-2">staged · {label(key)}</span>
            <StateCell
              {...cellFromDraft(cell, { value: show(cell.edit?.value), scale: "row" })}
              transitions={transitions(owner, wire.segment, key)}
            />
          </div>
        ) : (
          <ReviewRow
            key={key}
            wire={wire}
            address={key}
            label={<span className="t-small face-mono text-ink-2">staged · {label(key)}</span>}
            cell={cell}
            facts={{ value: show(cell.edit?.value), scale: "row" }}
            show={show}
          />
        ),
      )}
    </div>
  );
}

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
  cell: CellLike | undefined;
  wire: CellWire;
  onPatch: (value: number) => void;
}) {
  const owner = useTakeoffKernel();
  const move = useCellNavigation();
  const key = takeoffEditKey(roomId, field);
  const show = (raw: unknown) => fmtNum(Number(raw), digits);
  const shown = cell?.edit != null ? Number(cell.edit.value) : value;
  return (
    <StateCell
      {...cellFromDraft(cell ?? { edit: null }, {
        value: show(shown),
        modelValue: show(value),
        scale: "row",
        numeric: { integer, min: 0, digits },
      })}
      transitions={
        cell
          ? owner
            ? transitions(owner, wire.segment, key)
            : reviewTransitions(wire, key, cell)
          : undefined
      }
      onCommit={(text) => onPatch(Number(text))}
      onNavigate={(direction) => move?.(direction) ?? false}
    />
  );
}
