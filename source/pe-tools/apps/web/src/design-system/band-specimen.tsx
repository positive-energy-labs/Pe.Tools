/**
 * The band specimen's three consumers of one cell: the matrix table (row scale), a spec-style form
 * field (card scale) and the chat head's ask. Every verb is the cell's own transition; the band's
 * discard is only a fan-out of the same unstage patches.
 */
import type { RouteStatePatch } from "@pe/agent-contracts";
import { Check, X } from "lucide-react";

import { ActionButton } from "#/components/lang/action-button";
import { reviewPatches, reviewTransitions, type ReviewCell } from "#/components/lang/band";
import { cellFromTrichotomy, StateCell, type StateCellProps } from "#/components/lang/cell";
import { Gap } from "#/design-system/exhibit";
import { ReadCell } from "#/components/master-table/cells";
import type { Column } from "#/components/master-table/model";

import {
  cellKey,
  LOCKS,
  MATRIX,
  PARAMETERS,
  shownOf,
  stagePatch,
  type MatrixCells,
  type MatrixRow,
} from "./band-matrix";

export type Write = (patches: RouteStatePatch[]) => Promise<null>;

const EMPTY: ReviewCell = { proposal: null, staged: null };

/** One address as every consumer reads it: the reader's marks plus the cell's own verbs. */
export function cellState(cells: MatrixCells, key: string, write: Write): StateCellProps {
  const cell = cells[key] ?? EMPTY;
  const lock = LOCKS[key] ?? null;
  return {
    ...cellFromTrichotomy(cell, {
      value: shownOf(key, cell),
      cap: lock ? "locked" : "editable",
      capReason: lock ?? undefined,
    }),
    onCommit: lock ? undefined : (text) => void write([stagePatch(key, text)]),
    transitions: reviewTransitions("cells", key, cell, write, lock),
  };
}

/** A table row carries its cells: MasterTable re-renders a row only when its identity changes. */
export type StatefulRow = MatrixRow & { cells: MatrixCells };
// ponytail: every write re-identifies all 18 rows; slice per row if the matrix grows.
export const matrixRows = (cells: MatrixCells): StatefulRow[] =>
  MATRIX.map((row) => ({ ...row, cells }));

export const matrixColumns = (write: Write): Column<StatefulRow>[] => [
  {
    key: "family",
    label: "family",
    width: "w-44",
    lock: true,
    search: (row) => row.family,
    facet: (row) => row.family,
    cell: (row) => <ReadCell value={row.family} />,
  },
  {
    key: "type",
    label: "type",
    width: "w-16",
    search: (row) => row.type,
    cell: (row) => <ReadCell value={row.type} />,
  },
  ...PARAMETERS.map(
    (parameter): Column<StatefulRow> => ({
      key: parameter,
      label: parameter,
      width: "w-28",
      search: (row) => shownOf(cellKey(row.key, parameter), row.cells[cellKey(row.key, parameter)]),
      state: (row) => cellState(row.cells, cellKey(row.key, parameter), write),
    }),
  ),
];

/** The band's discard: the same unstage transition, fanned over every staged address. */
export const discardAll = (cells: MatrixCells, write: Write) =>
  write(
    Object.keys(cells)
      .filter((key) => cells[key]?.staged != null)
      .flatMap((key) => reviewPatches("cells").unstage(key)),
  );

/** A spec-editor field per parameter of one type: the same cell, at card scale. */
export function TypeForm({
  row,
  cells,
  write,
}: {
  row: MatrixRow;
  cells: MatrixCells;
  write: Write;
}) {
  return (
    <div className="flex flex-col">
      <p className="t-prose">
        <b>{row.type}</b> · {row.family}
      </p>
      {PARAMETERS.map((parameter) => (
        <div key={parameter} className="grid grid-cols-[9rem_minmax(0,1fr)] items-baseline py-1">
          <span className="text-ink-2">{parameter}</span>
          <StateCell {...cellState(cells, cellKey(row.key, parameter), write)} />
        </div>
      ))}
    </div>
  );
}

export type Ask = "live" | "allowed" | "refused" | "expired";

/** RULED: an ask lives as long as its awaiting turn; turn end, cancel and host restart expire it. */
export function AskHead({ ask, resolve }: { ask: Ask; resolve: (verdict: Ask) => void }) {
  return ask === "live" ? (
    <div className="flex flex-wrap items-baseline gap-3 py-1.5">
      <span className="face-mono text-ink">⌗ family.capture</span>
      <span>on Air Handler</span>
      <ActionButton
        tone="commit"
        icon={Check}
        label="allow"
        reason="Allow this transient tool call"
        onClick={() => resolve("allowed")}
      />
      <ActionButton
        icon={X}
        label="refuse"
        reason="Refuse this transient tool call"
        onClick={() => resolve("refused")}
      />
    </div>
  ) : (
    <p className="py-1.5 face-mono text-ink-2">
      family.capture {ask === "expired" ? "expired · the turn ended" : ask}
    </p>
  );
}

export function BandGaps() {
  return (
    <section className="flex flex-col gap-1.5">
      <span>known gaps and owed work</span>
      <Gap>
        <strong>Owed (phase 2):</strong> availability moves to <code>availableTransitions</code>;
        the band&apos;s discard and any header or group accept become <code>fanOut</code>.
      </Gap>
      <Gap>
        <strong>Structural proposals:</strong> the cell draws delete; rename and add-row have no
        language shape yet.
      </Gap>
    </section>
  );
}
