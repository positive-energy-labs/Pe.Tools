/**
 * The band specimen's three consumers of one cell: the matrix table (row scale), a spec-style form
 * field (card scale) and the chat head's ask. Every verb is the cell's own contract transition;
 * the band's discard and the Voltage column's accept-all are only `fanOut`s of the same kinds.
 */
import { Check, X } from "lucide-react";

import { ActionButton } from "#/components/lang/action-button";
import {
  reviewTransitions,
  runFanOut,
  type CellWire,
  type FanOutOutcome,
} from "#/components/lang/band";
import {
  cellFromTrichotomy,
  StateCell,
  type StateCellProps,
  stagedText,
} from "#/components/lang/cell";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { Section } from "#/components/lang/section";
import { ReadCell } from "#/components/master-table/cells";
import type { Column } from "#/components/master-table/model";
import { Gap } from "#/design-system/exhibit";

import { ProposalHead, type HeadWork } from "#/chat/proposal-head";

import {
  baselineOf,
  cellKey,
  LOCKS,
  MATRIX,
  PARAMETERS,
  shownOf,
  stagePatches,
  type MatrixCells,
  type MatrixRow,
} from "./band-matrix";

/** One state every consumer reads: the cells, how they are written, the last aggregate's outcome. */
export interface Matrix {
  cells: MatrixCells;
  wire: CellWire;
  outcome: FanOutOutcome | null;
}

export const matrixWire = (write: CellWire["write"]): CellWire => ({
  segment: "cells",
  write,
  baselineOf,
  // ponytail: the fixture has no Work; r0 stands in, and nothing ever writes against it.
  revision: 0,
  lockOf: (key) => LOCKS[key] ?? null,
});

/** One address as every consumer reads it: the reader's marks plus the cell's own verbs. */
export function cellState({ cells, wire, outcome }: Matrix, key: string): StateCellProps {
  const cell = cells[key] ?? {};
  const lock = LOCKS[key] ?? null;
  return {
    ...cellFromTrichotomy(cell, {
      value: shownOf(key, cell),
      cap: lock ? "locked" : "editable",
      capReason: lock ?? undefined,
    }),
    onCommit: lock
      ? undefined
      : (text) => void wire.write(stagePatches(cells, key, stagedText(text))),
    transitions: reviewTransitions(wire, key, cell),
    refused:
      outcome?.refusal && outcome.covered.includes(key) ? outcome.refusal.message : undefined,
  };
}

/** A table row carries its state: Table re-renders a row only when its identity changes. */
export type StatefulRow = MatrixRow & { matrix: Matrix };
// ponytail: every write re-identifies all 18 rows; slice per row if the matrix grows.
export const matrixRows = (matrix: Matrix): StatefulRow[] =>
  MATRIX.map((row) => ({ ...row, matrix }));

export const MATRIX_COLUMNS: Column<StatefulRow>[] = [
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
      search: (row) =>
        shownOf(cellKey(row.key, parameter), row.matrix.cells[cellKey(row.key, parameter)]),
      state: (row) => cellState(row.matrix, cellKey(row.key, parameter)),
    }),
  ),
];

/** The column aggregate: `accept` fanned over every Voltage address. Contested keys are skipped. */
export const acceptVoltage = ({ cells, wire }: Matrix) =>
  runFanOut(
    wire,
    cells,
    MATRIX.map((row) => cellKey(row.key, "Voltage")),
    "accept",
  );

/** A spec-editor field per parameter of one type: the same cell, at card scale. */
export function TypeForm({ row, matrix }: { row: MatrixRow; matrix: Matrix }) {
  return (
    <div className="flex flex-col">
      <p className="t-prose">
        <b>{row.type}</b> · {row.family}
      </p>
      {PARAMETERS.map((parameter) => (
        <div key={parameter} className="grid grid-cols-[9rem_minmax(0,1fr)] items-baseline py-1">
          <span className="text-ink-2">{parameter}</span>
          <StateCell {...cellState(matrix, cellKey(row.key, parameter))} />
        </div>
      ))}
    </div>
  );
}

export type Ask = "live" | "allowed" | "refused" | "expired";

/** A live ask: one head line with its answer. RULED: it lives as long as its awaiting turn. */
function AskLine({ resolve }: { resolve: (verdict: Ask) => void }) {
  return (
    <div className="flex flex-wrap items-baseline gap-3 py-0.5">
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
  );
}

/** A matrix address's group path: parameter › family › type. */
const matrixGroupOf = (key: string) => {
  const [type, parameter] = key.split("::") as [string, string];
  return [parameter, MATRIX.find((row) => row.key === type)?.family ?? "", type];
};

/** The matrix as the Chat head reads it: the same cells, wire and group path as the table. */
export const matrixHeadWork = (matrix: Matrix, say: (text: string) => void): HeadWork => ({
  id: "families:MEP Coordination.rvt",
  route: "Families",
  subject: "MEP Coordination.rvt",
  cells: matrix.cells,
  wire: matrix.wire,
  groupOf: matrixGroupOf,
  commit: {
    word: "plan",
    run: () => say("SIMULATED · the Families pane opens unscoped and plans"),
  },
  open: (focus) =>
    say(`SIMULATED · the Families pane opens${focus ? ` on ${focus.join(" › ")}` : ""}`),
});

export function BandGaps() {
  return (
    <section className="flex flex-col gap-1.5">
      <span>known gaps and owed work</span>
      <Gap>
        <strong>Fixture revision:</strong> the specimen holds no Work, so accept and deny bind to a
        stand-in r0 that nothing else writes; it cannot show a stale-revision refusal.
      </Gap>
      <Gap>
        <strong>Delete:</strong> a person clears a value to empty everywhere; deleting the property
        is opt-in in the cell contract and only settings cells take it, so this matrix draws none.
      </Gap>
    </section>
  );
}

/** Chat scale: the composer head's summary on the same matrix, and the transcript's records. */
export function ChatScale({
  ask,
  setAsk,
  matrix,
  say,
}: {
  ask: Ask;
  setAsk: (ask: Ask) => void;
  matrix: Matrix;
  say: (text: string) => void;
}) {
  return (
    <Section label="02 · chat scale">
      <ArtifactFrame
        head={
          <span className="flex items-baseline gap-2">
            <b>Pea</b> in Families on MEP Coordination.rvt
          </span>
        }
      >
        <div className="flex flex-col px-3 py-2">
          <ProposalHead
            asks={ask === "live" ? [<AskLine key="ask" resolve={setAsk} />] : []}
            works={[matrixHeadWork(matrix, say)]}
          />
          <span className="pt-2 t-small t-upper text-ink-2">transcript</span>
          {ask === "live" ? null : (
            <p className="face-mono text-ink-2">
              family.capture {ask === "expired" ? "expired · the turn ended" : ask}
            </p>
          )}
        </div>
      </ArtifactFrame>
      <div className="flex flex-wrap items-baseline gap-3 pt-2">
        <ActionButton
          label="end turn · SIMULATED"
          reason="Ends Pea's turn; its awaiting ask expires with it"
          disabled={ask !== "live"}
          onClick={() => setAsk("expired")}
        />
        <span className="t-small text-ink-2">
          Ruled: an ask lives as long as its awaiting turn. Turn end, cancel and host restart expire
          it; navigation and reload do not.
        </span>
      </div>
    </Section>
  );
}
