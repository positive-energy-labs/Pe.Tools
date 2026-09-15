import { useState } from "react";

import { CellStateKey } from "#/components/lang/cell-key";
import { StateCell } from "#/components/lang/cell";
import { FactChip, NarrowChip, Tag } from "#/components/lang/chip";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { CounterExample, Demo, Gap } from "#/design-system/exhibit";
import { PARAM_ROWS, cellProps, type ParamRow } from "#/design-system/specimens-data";

const CELL_KEYS = [
  "fireRating",
  "sillHeight",
  "operatorType",
  "panelThickness",
  "frameDepth",
  "roughWidth",
  "headHeight",
  "mark",
  "zoneArea",
  "typeComments",
  "connectedLoad",
] as const;

const CELL_NOTES: Record<(typeof CELL_KEYS)[number], string> = {
  fireRating: "Pea proposes: the body wash and Pea mark travel together.",
  sillHeight: "You staged: bold and the caution square are reserved for unsaved work.",
  operatorType: "Pea staged: the square keeps its shape and changes authorship colour.",
  panelThickness: "Drift: the one alarm and the model's value as a struck ghost.",
  frameDepth: "Stale read: squiggle priority two.",
  roughWidth: "Never checked: the quietest squiggle.",
  headHeight: "Formula locked: the refusal owns the body.",
  mark: "Excluded by Revit: a distinct refusal carried in words.",
  zoneArea: "Seam: typed data with no real element behind it.",
  typeComments: "Long value with a citation: one clamped footline.",
  connectedLoad: "Crucible: Pea proposes while the model disagrees.",
};

const MATRIX = CELL_KEYS.map((key) => ({
  row: PARAM_ROWS.find((candidate) => candidate.key === key) as ParamRow,
  note: CELL_NOTES[key],
}));

const OUTCOMES: readonly { kind: OutcomeKind; label: string; says: string }[] = [
  { kind: "busy", label: "applying · 3s", says: "in flight" },
  { kind: "receipt", label: "42 parameters written", says: "it landed" },
  { kind: "refused", label: "refused · plan hash drift", says: "nothing was touched" },
  { kind: "advisory", label: "2 types would be skipped", says: "dry run" },
  { kind: "error", label: "bridge busy", says: "operational error" },
];

export function CatalogueCells() {
  return (
    <>
      <ChipCatalogue />
      <Demo
        label="StateCell"
        consumers="MasterTable cells, proposal cards, and CellStateKey"
        spec="One grammar carries proposal, authorship, freshness, disagreement, capability, and provenance without making the row taller."
      >
        <div className="flex flex-col">
          {MATRIX.map(({ row, note }) => (
            <div
              key={row.key}
              className="grid grid-cols-1 items-baseline gap-x-5 gap-y-1 py-2 sm:grid-cols-[8rem_minmax(0,22rem)_minmax(0,1fr)]"
            >
              <span className="t-small face-mono text-ink-mute">{row.param}</span>
              <span className="min-w-0">
                <StateCell {...cellProps(row)} />
              </span>
              <span className="t-small face-mono text-ink-2">{note}</span>
            </div>
          ))}
        </div>
        <CounterExample why="a proposal on a locked cell is swallowed, and the caller receives no refusal">
          <StateCell value="84 in" cap="locked" capReason="driven by formula" stage="proposed" />
        </CounterExample>
      </Demo>

      <Demo
        label="CellStateKey"
        consumers="every surface that mounts StateCell"
        spec="The key renders real StateCell specimens in the same precedence order as the table. It cannot teach a treatment the component does not use."
      >
        <CellStateKey />
        <Gap>
          the key is a fixed list. It cannot derive the axes present in the rows currently on
          screen.
        </Gap>
      </Demo>

      <Demo
        label="OutcomeLine"
        consumers="write receipts and refusal lanes"
        spec="An outcome reports what happened in one line. It reuses existing meaning roles and never becomes an artifact frame."
      >
        <div className="flex flex-col">
          {OUTCOMES.map((outcome) => (
            <OutcomeLine key={outcome.kind} {...outcome} />
          ))}
        </div>
        <CounterExample why="a receipt reports on state but is not itself an enclosed machine object">
          <Tag>boxed receipt · 42 written</Tag>
        </CounterExample>
        <Gap>
          OutcomeLine carries no target, time, verb, or item list, so several concurrent writes can
          produce orphan receipts.
        </Gap>
      </Demo>
    </>
  );
}

function ChipCatalogue() {
  const [narrowings, setNarrowings] = useState(["needs a person", "type · FDCL-611"]);
  return (
    <Demo
      label="FactChip · NarrowChip · Tag"
      consumers="artifact heads, table narrowings, plan facts, and compact object names"
      spec="FactChip reports a measured fact. NarrowChip removes one active narrowing. Tag names an object without pretending it is state."
    >
      <div className="flex flex-wrap items-center gap-2">
        <FactChip title="The plan this write was made against.">plan a91f#c04</FactChip>
        <FactChip tone="pea" title="Pea's proposed values.">
          2 proposed
        </FactChip>
        <FactChip tone="caution" title="Unsaved values.">
          2 unsaved
        </FactChip>
        <FactChip tone="done" title="Written values.">
          42 written
        </FactChip>
        <FactChip dashed title="Fixture data; no real document stands behind it.">
          fixture
        </FactChip>
        <Tag>door 421</Tag>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {narrowings.map((label) => (
          <NarrowChip
            key={label}
            label={label}
            count={label === "needs a person" ? 3 : 1}
            title="Remove this narrowing to widen the view."
            onRemove={() => setNarrowings((current) => current.filter((item) => item !== label))}
          />
        ))}
      </div>
      <CounterExample why="caution would claim temporary state for a permanent category">
        <FactChip tone="caution" title="Discipline">
          mechanical
        </FactChip>
      </CounterExample>
      <Gap>
        NarrowChip owns removal, but no catalogue-level component owns adding a removed narrowing
        back. That belongs to the addressing surface.
      </Gap>
    </Demo>
  );
}
