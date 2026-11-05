/**
 * Table controls, round 2 (2026-10-19): the real `TableFrame` over two fixture tables. The query
 * box, the Filters workbench and every header button are the kit's one query (`@pe/kit/table/
 * query`, `query-workbench`); this page only supplies data, presets and one honest local command.
 * `/design-system/table-controls?dataset=segments|parameters`.
 */
import { useState } from "react";
import type { RowData } from "@tanstack/react-table";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "@pe/kit/lang/button";
import { FactChip } from "@pe/kit/lang/chip";
import { ListPopup } from "@pe/kit/lang/list-popup";
import type { QueryCommand, TableState } from "@pe/kit/table/model";
import { Table } from "@pe/kit/table/table";
import { TextCell } from "@pe/kit/table/cells";
import { emptyTableState } from "@pe/kit/table/view";
import { defaultFilterQuery } from "@pe/kit/table/query-filters";
import { TableFrame } from "#/components/master-table/table-frame";
import {
  PARAMETER_DATASET,
  SEGMENT_DATASET,
  datasetQuery,
  type Dataset,
  type Preset,
} from "./fixtures";

const DATASETS = [SEGMENT_DATASET, PARAMETER_DATASET] as const;

export function Lineup({ dataset }: { dataset: string }) {
  const navigate = useNavigate();
  const active = DATASETS.find((each) => each.id === dataset) ?? DATASETS[0];
  // Each table keeps its own view: switching never carries one schema's query to the other.
  const [states, setStates] = useState<Record<string, TableState>>({});
  const state = states[active.id] ?? {
    ...emptyTableState(),
    query: defaultFilterQuery(active.filters ?? []),
  };
  const setState = (next: TableState) => setStates((all) => ({ ...all, [active.id]: next }));
  const go = (dataset: string) =>
    void navigate({ to: "/design-system/table-controls", search: { dataset } });
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="t-small t-upper">table controls</span>
        <FactChip dashed title="Hand-authored rows; not Revit data.">
          fixture
        </FactChip>
        {DATASETS.map((each) => (
          <Button
            key={each.id}
            kind="framed"
            label={`show ${each.label}`}
            pressed={each.id === active.id}
            onClick={() => go(each.id)}
          >
            {each.label}
          </Button>
        ))}
        <ListPopup<Preset>
          anchor="trigger"
          face="control"
          trigger="Example queries"
          triggerLabel="Example queries"
          title="Pick a real query for this table: it writes the box, the chips and the sorts."
          items={active.presets}
          keyOf={(item) => item.id}
          labelOf={(item) => item.label}
          detailOf={(item) => item.says}
          filter="words"
          searchAbove={0}
          searchPlaceholder="search example queries"
          aria-label="Example queries"
          empty="no examples"
          maxHeight="18rem"
          onPick={(item) => setState({ ...state, ...item.state })}
          row={(item) => ({ label: item.label, meta: item.says })}
        />
        <Button
          label="reset view"
          refusal={
            state.query || state.sorts.length ? null : "Nothing is narrowing or ordering the table."
          }
          onClick={() => setState(emptyTableState())}
        >
          reset
        </Button>
      </div>
      <ul className="flex shrink-0 flex-wrap gap-x-4 t-small text-ink-2">
        {active.constraints.map((line) => (
          <li key={line}>{line}</li>
        ))}
        {active.id === "segments" && (
          <li>Note cells are editable here; changes stay in this fixture.</li>
        )}
      </ul>
      {active.id === "segments" ? (
        <SegmentSpecimen state={state} onStateChange={setState} />
      ) : (
        <Specimen
          key="parameters"
          dataset={PARAMETER_DATASET}
          state={state}
          onStateChange={setState}
        />
      )}
    </div>
  );
}

function SegmentSpecimen({
  state,
  onStateChange,
}: {
  state: TableState;
  onStateChange: (state: TableState) => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const dataset = {
    ...SEGMENT_DATASET,
    rows: SEGMENT_DATASET.rows.map((row) => ({ ...row, note: notes[row.tag] ?? row.note })),
    columns: SEGMENT_DATASET.columns.map((column) =>
      column.key !== "note" || column.cell === undefined
        ? column
        : {
            ...column,
            cell: (row: (typeof SEGMENT_DATASET.rows)[number]) => (
              <TextCell
                value={row.note}
                onCommit={(note) => setNotes((current) => ({ ...current, [row.tag]: note }))}
              />
            ),
          },
    ),
  };
  return <Specimen dataset={dataset} state={state} onStateChange={onStateChange} />;
}

function Specimen<Row extends RowData>({
  dataset,
  state,
  onStateChange,
}: {
  dataset: Dataset<Row>;
  state: TableState;
  onStateChange: (state: TableState) => void;
}) {
  // The command example is local and says so: it reads the kept rows and changes nothing.
  const [armed, setArmed] = useState(false);
  const [inspect, setInspect] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const projection = datasetQuery(dataset, state);
  const shown = projection.rows(state.query);
  const custom = Boolean(dataset.rules?.length);
  const rows = custom ? shown : dataset.rows;
  const kept = shown.length;
  const command: QueryCommand | undefined =
    dataset.id === "segments"
      ? {
          armed,
          onArmed: (next) => {
            setArmed(next);
            if (!next) setInspect(false);
          },
          chips: inspect
            ? [
                {
                  key: "inspect",
                  label: "inspect",
                  title: "Counts the kept rows in this fixture. Removing it undoes nothing.",
                  onRemove: () => setInspect(false),
                },
              ]
            : [],
          tokens: (typed) =>
            !inspect && "inspect".startsWith(typed)
              ? [
                  {
                    key: "inspect",
                    label: "inspect",
                    hint: "count the kept rows (local)",
                    take: () => setInspect(true),
                  },
                ]
              : [],
          onCommit: () =>
            setReport(
              inspect
                ? `Inspected ${kept} segment${kept === 1 ? "" : "s"} (fixture; no Revit)`
                : "Choose inspect first",
            ),
          says: "Inspect counts the rows the query keeps, in this fixture only",
          placeholder: "inspect, then Enter",
        }
      : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <TableFrame
        label={dataset.label}
        rows={rows}
        rowCount={{ shown: kept, total: dataset.rows.length }}
        columns={dataset.columns}
        rowKey={dataset.rowKey}
        state={state}
        onStateChange={onStateChange}
        command={command}
        query={custom ? projection.vocabulary : undefined}
        summary={report ?? undefined}
      >
        <Table
          rows={rows}
          columns={dataset.columns}
          rowKey={dataset.rowKey}
          label={dataset.label}
          state={custom ? { ...state, query: "" } : state}
          onStateChange={(next) => onStateChange({ ...next, query: state.query })}
        />
      </TableFrame>
    </div>
  );
}
