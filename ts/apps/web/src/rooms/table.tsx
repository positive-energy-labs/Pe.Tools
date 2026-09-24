/**
 * The rooms table: one row per Room Region. Every edit stages a Work cell (`transitionPatches`)
 * against what the region holds in Revit; nothing is written until `apply`.
 */
import { useMemo } from "react";
import {
  roomEditKey,
  roomEditSchema,
  transitionPatches,
  type RoomEditField,
  type RoomsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";

import { reviewTransitions, type CellWire } from "#/components/lang/band";
import { cellFromTrichotomy, type StateCellProps } from "#/components/lang/cell";
import { EmptyState } from "#/components/lang/empty";
import { CellListSelect } from "#/components/lang/list-popup";
import type { Column, Verdict } from "#/components/master-table/model";
import { Table } from "#/components/master-table/table";
import { REGION_INK, regionLabel, regionState, type RoomRow, type RoomsRegion } from "./plan";

const ROOM_TYPES = roomEditSchema.shape.type.unwrap().options;
type RoomType = (typeof ROOM_TYPES)[number];
type Cells = RoomsRouteDocument["edits"];

const NUMBERS = [
  ["ceilingFt", "ceiling", "ceiling height, ft"],
  ["people", "people", "occupants"],
  ["lightingW", "light W", "lighting load, W"],
  ["equipSensible", "eq sens", "equipment sensible load, Btu/h"],
  ["equipLatent", "eq lat", "equipment latent load, Btu/h"],
  ["ventilationCfm", "vent", "ventilation, CFM"],
] as const satisfies readonly (readonly [RoomEditField, string, string])[];

/** Level (in the snapshot's level order) then area, largest first; `R{n}` counts in that order. */
export function roomRows(regions: readonly RoomsRegion[], levels: readonly string[]): RoomRow[] {
  const rank = (level: string) => {
    const at = levels.indexOf(level);
    return at < 0 ? levels.length : at;
  };
  return [...regions]
    .sort(
      (a, b) => rank(a.level) - rank(b.level) || a.level.localeCompare(b.level) || b.sqft - a.sqft,
    )
    .map((region, index) => ({ region, label: regionLabel(region, index) }));
}

/** One field's stage: equal to what Revit holds stages nothing (the cell unstages). */
export const stagePatches = (
  cells: Cells,
  region: RoomsRegion,
  field: RoomEditField,
  value: string | number,
): RouteStatePatch[] => {
  const key = roomEditKey(region.guid, field);
  const held = region[field];
  return transitionPatches(["edits"], key, cells[key] ?? {}, {
    kind: "stage",
    rung: { value },
    ...(held === null || held === undefined || held === "" ? {} : { baseline: { value: held } }),
  });
};

/** A field as the cell shows it: Revit's null is empty, never "null". */
const shown = (value: string | number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

const VERDICT_TONE = { locked: "ink", stale: "caution", held: "mute", machine: "mute" } as const;

export function RoomsTable({
  rows,
  cells,
  wire,
  selected,
  hovered,
  onSelect,
  onHover,
  empty,
}: {
  rows: readonly RoomRow[];
  cells: Cells;
  wire: CellWire;
  selected: ReadonlySet<string>;
  hovered: string | null;
  onSelect: (guids: ReadonlySet<string>) => void;
  onHover: (guid: string | null) => void;
  empty: { says: string; exit: string };
}) {
  const columns = useMemo<Column<RoomRow>[]>(() => {
    const stage = (region: RoomsRegion, field: RoomEditField, value: string | number) =>
      wire.write(stagePatches(cells, region, field, value)).then((refusal) => refusal?.message);
    const cellOf = (row: RoomRow, field: RoomEditField, numeric: boolean): StateCellProps => {
      const key = roomEditKey(row.region.guid, field);
      const cell = cells[key] ?? {};
      const held = shown(row.region[field]);
      const authored = cell.staged ?? cell.proposal;
      return {
        ...cellFromTrichotomy(cell, {
          value: authored ? shown(authored.value) : held,
          cap: "editable",
          note:
            authored && shown(authored.value) !== held
              ? `Revit holds ${held || "nothing"}`
              : undefined,
        }),
        ...(numeric ? { numeric: { min: 0, digits: 2 } } : {}),
        onCommit: (text: string) =>
          numeric ? stage(row.region, field, Number(text)) : stage(row.region, field, text),
        transitions: reviewTransitions(wire, key, cell),
      };
    };
    return [
      {
        key: "level",
        label: "level",
        width: "w-28",
        sort: (row) => row.region.level,
        facet: (row) => row.region.level,
        cell: (row) => <span className="block truncate px-(--item-pad-x)">{row.region.level}</span>,
      },
      {
        key: "name",
        label: "name",
        width: "min-w-36",
        search: (row) => `${row.label} ${row.region.name}`,
        sort: (row) => row.label,
        state: (row) => ({ ...cellOf(row, "name", false), placeholder: row.label }),
      },
      {
        key: "type",
        label: "type",
        width: "w-32",
        facet: (row) => row.region.type,
        options: ROOM_TYPES.map((type) => ({ value: type, label: type })),
        cell: (row) => {
          const key = roomEditKey(row.region.guid, "type");
          const cell = cells[key];
          const value = shown(cell?.staged?.value ?? row.region.type);
          return (
            <CellListSelect<RoomType>
              aria-label={`${row.label} type`}
              value={value}
              display={cell?.staged ? <b>{value}</b> : value || "—"}
              title={
                cell?.staged ? `staged · Revit holds ${row.region.type || "nothing"}` : undefined
              }
              items={ROOM_TYPES}
              keyOf={(type) => type}
              labelOf={(type) => type}
              empty="no room types"
              select="single"
              selected={[value]}
              onPick={(type) => void stage(row.region, "type", type)}
              row={(type) => ({ label: type })}
            />
          );
        },
      },
      ...NUMBERS.map(
        ([field, label, title]): Column<RoomRow> => ({
          key: field,
          label,
          title,
          right: true,
          width: "w-16",
          sort: (row) => row.region[field] ?? Number.NEGATIVE_INFINITY,
          state: (row) => cellOf(row, field, true),
        }),
      ),
      {
        key: "sqft",
        label: "sf",
        title: "measured area of the region in Revit; geometry is edited in Revit",
        right: true,
        width: "w-16",
        sort: (row) => row.region.sqft,
        cell: (row) => (
          <span className="block px-(--item-pad-x) text-right face-mono">
            {row.region.sqft.toFixed(0)}
          </span>
        ),
      },
      {
        key: "state",
        label: "state",
        width: "w-20",
        verdict: (row): Verdict => {
          const state = regionState(row.region);
          return { word: state, tone: VERDICT_TONE[state], note: REGION_INK[state].says };
        },
      },
    ];
  }, [cells, wire]);

  return (
    <Table
      label="room regions"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.region.guid}
      selection={{ selected, onChange: onSelect }}
      activeKey={hovered}
      onRowHover={(row) => onHover(row?.region.guid ?? null)}
      empty={
        <EmptyState story="scope" exit={empty.exit}>
          {empty.says}
        </EmptyState>
      }
    />
  );
}
