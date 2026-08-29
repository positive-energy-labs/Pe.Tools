import { useMemo } from "react";
import { useAtomValue } from "@effect/atom-react";
import { CellSelect, NumberCell, ReadCell, TextCell } from "#/components/master-table/cells";
import { cellStateLabel, type StateCellProps } from "#/components/lang/cell";
import { fmtNum, type Column } from "#/components/master-table/model";
import { cn } from "#/lib/utils";
import type { AtlasActions } from "#/takeoff/atlas";
import { ManualJField } from "#/takeoff/manual-j-field";
import { MANUAL_J } from "#/takeoff/room-actions";
import { ROOM_STATES, STATE_META, STAGE_BLURB, stateMeta } from "#/takeoff/room-state";
import { ATLAS_COLUMN_SEMANTICS, type AtlasRow as Row, type TakeoffStore } from "#/takeoff/store";
import { STAGE_ORDER, type RoomType } from "#/takeoff/world";

const ROOM_TYPES: RoomType[] = [
  "great room",
  "kitchen",
  "dining",
  "primary bedroom",
  "bedroom",
  "full bath",
  "powder",
  "office",
  "laundry",
  "exercise",
  "hall",
  "mechanical",
];

function RoomNameCell({
  store,
  row,
  onCommit,
}: {
  store: TakeoffStore;
  row: Row;
  onCommit: (value: string) => void;
}) {
  const entity = useAtomValue(store.atoms.entity(row.room.guid));
  const state = [
    entity.hovered ? "hovered" : null,
    entity.selected ? "table selection" : null,
    entity.dirty ? "staged" : null,
    entity.conflict ? "authority changed" : null,
  ].filter(Boolean);
  return (
    <div
      data-dirty={entity.dirty || undefined}
      data-conflict={entity.conflict || undefined}
      title={state.join(" · ") || undefined}
      className={cn(
        "flex min-w-0 items-center",
        entity.hovered && "veil",
        entity.selected && "on-select",
      )}
    >
      <div className="min-w-0 flex-1">
        <TextCell value={row.room.name} onCommit={onCommit} className="text-left" />
      </div>
      {entity.dirty && (
        <span className={cn("face-mono t-caption pr-1", entity.conflict && "text-caution")}>
          {entity.conflict ? "conflict" : "staged"}
        </span>
      )}
    </div>
  );
}

function r10State(row: Row): StateCellProps {
  const r10 = row.room.r10;
  if (!r10) return { value: "not exported", fresh: "never" };
  const drift = row.room.sqft - r10.lastSyncedSqft;
  return drift === 0
    ? { value: `#${r10.identifier}`, agree: "agree", fresh: "fresh" }
    : {
        value: `#${r10.identifier}`,
        agree: "drift",
        // The struck ghost token: what the .r10 still holds, at zero row-height cost.
        modelValue: `${fmtNum(r10.lastSyncedSqft, 0)} sf`,
      };
}

// ── Variant ─────────────────────────────────────────────────────────────────

export function useAtlasColumns({
  actions,
  fieldsMode,
  flagVocabulary,
  store,
}: {
  actions: AtlasActions;
  fieldsMode: "columns" | "panel";
  flagVocabulary: string[];
  store: TakeoffStore;
}) {
  return useMemo<Column<Row>[]>(
    () => [
      {
        key: "stage",
        label: "stage",
        title: "the ZONE's pipeline label — not a claim about this room",
        width: "w-28",
        sort: ATLAS_COLUMN_SEMANTICS.stage.sort,
        facet: ATLAS_COLUMN_SEMANTICS.stage.facet,
        options: STAGE_ORDER.map((s) => ({ value: s, label: s })),
        cell: (row) => (
          <ReadCell
            value={`${STAGE_ORDER.indexOf(row.zone.stage) + 1} ${row.zone.stage}`}
            reason={`zone ${row.zone.zone.key} is at "${row.zone.stage}" — ${STAGE_BLURB[row.zone.stage]}. This is a ZONE label; the room's own state is the next column.`}
            className="text-ink-2"
          />
        ),
      },
      {
        key: "state",
        label: "state",
        title:
          "this ROOM's derived state — the same vocabulary the rail bars and the plan fills use",
        verdict: (row) => stateMeta(row.state),
        sort: ATLAS_COLUMN_SEMANTICS.state.sort,
        facet: ATLAS_COLUMN_SEMANTICS.state.facet,
        options: ROOM_STATES.map((s) => ({
          value: STATE_META[s].label,
          label: STATE_META[s].label,
        })),
      },
      {
        key: "zone",
        label: "zone",
        width: "w-24",
        sort: ATLAS_COLUMN_SEMANTICS.zone.sort,
        search: (row) => row.zone.zone.key,
        cell: (row) => (
          <span className="face-mono t-value block truncate px-1.5">
            <span
              className="mr-1 inline-block size-2 rounded-[1px] align-middle"
              style={{ backgroundColor: `rgb(${row.zone.zone.color})` }}
            />
            {row.zone.zone.key}
          </span>
        ),
      },
      {
        key: "name",
        label: "name",
        width: "min-w-40",
        sort: ATLAS_COLUMN_SEMANTICS.name.sort,
        search: (row) => row.room.name,
        cell: (row) => (
          <RoomNameCell
            store={store}
            row={row}
            onCommit={(value) => actions.patch(row.room.guid, { name: value })}
          />
        ),
      },
      {
        key: "type",
        label: "type",
        width: "w-32",
        sort: ATLAS_COLUMN_SEMANTICS.type.sort,
        search: (row) => row.room.type,
        facet: ATLAS_COLUMN_SEMANTICS.type.facet,
        options: ROOM_TYPES.map((t) => ({ value: t, label: t })),
        cell: (row) => (
          <CellSelect
            value={row.room.type}
            onChange={(v) => actions.patch(row.room.guid, { type: v as RoomType })}
          >
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </CellSelect>
        ),
      },
      {
        key: "sqft",
        label: "sf",
        title: "detected area — geometry is edited in Revit",
        right: true,
        width: "w-16",
        sort: ATLAS_COLUMN_SEMANTICS.sqft.sort,
        cell: (row) => (
          <ReadCell
            value={row.room.sqft}
            reason={`detected area — source ${row.room.provenance.sourceSqft} sf, run ${row.room.provenance.runId}. Geometry is edited in Revit, never here.`}
          />
        ),
      },
      // The Manual J block (+ ceiling): same shape, same law — the never rung (muted ink, R2)
      // until the room has data, and any number entered CREATES that data (the room's state
      // moves to "data entered").
      // In panel mode these fields move to the room panel; the table narrows to identity+status.
      ...(fieldsMode === "columns"
        ? [
            {
              key: "ceil",
              label: "ceil",
              right: true,
              width: "w-14",
              sort: ATLAS_COLUMN_SEMANTICS.ceil.sort,
              cell: (row) => (
                <NumberCell
                  value={row.room.ceilingFt}
                  digits={1}
                  min={0}
                  onCommit={(v) => actions.patch(row.room.guid, { ceilingFt: v })}
                />
              ),
            } satisfies Column<Row>,
            ...MANUAL_J.map(
              (mj): Column<Row> => ({
                key: mj.field,
                label: mj.label,
                right: true,
                width: mj.width,
                sort: ATLAS_COLUMN_SEMANTICS[mj.field].sort,
                cell: (row) => (
                  <ManualJField
                    room={row.room}
                    field={mj.field}
                    onPatch={(patch) => actions.patch(row.room.guid, patch)}
                  />
                ),
              }),
            ),
          ]
        : []),
      {
        key: "flags",
        label: "flags",
        width: "w-24",
        title: "undecided detector calls on this room — a/d accept or dismiss the first one",
        sort: ATLAS_COLUMN_SEMANTICS.flags.sort,
        // Multi-valued: a room carries a SET of flags, so the vocabulary is "any open" /
        // "none open" / one named flag rather than a single cell value.
        match: ATLAS_COLUMN_SEMANTICS.flags.match,
        options: [
          { value: "any", label: "any open" },
          { value: "none", label: "none open" },
          ...flagVocabulary.map((f) => ({ value: f, label: f })),
        ],
        // The owed COUNT and the alarm ink now live in the table's gutter (the owed marker,
        // ruled 2026-08-16) — this column keeps only the FILTER job, so its cell is trimmed to
        // the filterable words themselves: the open flag names, plain ink, no double mark.
        cell: (row) =>
          row.open.length > 0 ? (
            <span
              className="face-mono t-value block truncate px-1.5 text-ink-2"
              title={row.open.join(", ")}
            >
              {row.open.join(", ")}
            </span>
          ) : row.room.decisions.length > 0 ? (
            <span className="face-mono t-value block truncate px-1.5 text-ink-2">
              {row.room.decisions.length} decided
            </span>
          ) : null,
      },
      {
        // THE CELL-STATE CLAUSE, consumer #2. This column is a DIFF — what the .r10 holds against
        // what the model holds — which is exactly what the grammar's `agree` axis is for. The
        // column declares what it draws; MasterTable renders `StateCell`, and facet/sort fall
        // through to the grammar's own vocabulary and attention order. The old hand-rolled
        // `sort: identifier` is deliberately dropped: drift now sorts to the top, which is the
        // order the work happens in (SURFACE-PHILOSOPHY §1).
        key: "r10",
        label: ".r10",
        width: "w-28",
        title:
          "this room's line in the .r10, and whether it still agrees with the model. Read-only: the identifier is assigned by sync, never typed.",
        state: r10State,
        sort: ATLAS_COLUMN_SEMANTICS.r10.sort,
        facet: ATLAS_COLUMN_SEMANTICS.r10.facet,
        // The domain word for the never rung (`StateColumn.word`, ruled with #1 and R2): the
        // universal "never" is true but the route's fact is sharper — nothing of this room was
        // ever exported. The marks stay universal; every other row keeps the grammar's word.
        word: (row) => (row.room.r10 ? cellStateLabel(r10State(row)) : "not exported"),
      },
    ],
    [actions, flagVocabulary, fieldsMode],
  );
}
