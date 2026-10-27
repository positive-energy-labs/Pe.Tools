import { useContext } from "react";
import { AttentionDocument, elementKey, useAttention } from "@pe/kit/lang/attention";
/**
 * The rooms table: one row per zone, room and held region. Every edit stages a Work cell (`transitionPatches`)
 * against what the region holds in Revit; nothing is written until `apply`.
 */
import { useMemo, useState } from "react";
import type { TableState } from "@pe/kit/table/model";
import { visibleRows } from "@pe/kit/table/view";
import { TableFrame } from "#/components/master-table/table-frame";
import {
  roomEditKey,
  roomEditSchema,
  transitionPatches,
  type RoomEditField,
  type RoomsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";

import { reviewTransitions, type CellWire } from "#/components/work/band";
import { cellFromTrichotomy, type StateCellProps } from "@pe/kit/lang/cell";
import { EmptyState } from "@pe/kit/lang/empty";
import { CellListSelect } from "@pe/kit/lang/list-popup";
import type { Column, Verdict } from "@pe/kit/table/model";
import { Table } from "@pe/kit/table/table";
import {
  REGION_INK,
  regionLabel,
  lockedStale,
  regionState,
  unassigned,
  type RoomRow,
  type RoomsRegion,
} from "./plan";

const ROOM_TYPES = roomEditSchema.shape.type.unwrap().options;
type RoomType = (typeof ROOM_TYPES)[number];
const ROLES = roomEditSchema.shape.role.unwrap().options;
type Role = (typeof ROLES)[number];
type Cells = RoomsRouteDocument["edits"];

const NUMBERS = [
  ["ceilingFt", "ceiling", "ceiling height, ft"],
  ["people", "people", "occupants"],
  ["lightingW", "light W", "lighting load, W"],
  ["equipSensible", "eq sens", "equipment sensible load, Btu/h"],
  ["equipLatent", "eq lat", "equipment latent load, Btu/h"],
  ["ventilationCfm", "vent", "ventilation, CFM"],
] as const satisfies readonly (readonly [RoomEditField, string, string])[];

/**
 * Level (in the snapshot's level order), then zones, their rooms zone by zone, unassigned rooms,
 * held; area largest first within each. `R{n}` counts in that order.
 */
export function roomRows(regions: readonly RoomsRegion[], levels: readonly string[]): RoomRow[] {
  const rank = (level: string) => {
    const at = levels.indexOf(level);
    return at < 0 ? levels.length : at;
  };
  const zones = regions
    .filter((region) => region.role === "zone")
    .sort((a, b) => b.sqft - a.sqft)
    .map((zone) => zone.guid);
  const zoneAt = (guid: string | null | undefined) => {
    const at = guid == null ? -1 : zones.indexOf(guid);
    return at < 0 ? zones.length : at;
  };
  const group = (region: RoomsRegion) =>
    region.role === "zone" ? 0 : region.role === "held" ? 3 : unassigned(region) ? 2 : 1;
  return [...regions]
    .sort(
      (a, b) =>
        rank(a.level) - rank(b.level) ||
        a.level.localeCompare(b.level) ||
        group(a) - group(b) ||
        zoneAt(a.zone) - zoneAt(b.zone) ||
        b.sqft - a.sqft,
    )
    .map((region, index) => ({ region, label: regionLabel(region, index) }));
}

/** One field's stage: equal to what Revit holds stages nothing (the cell unstages). */
const stagePatches = (
  cells: Cells,
  region: RoomsRegion,
  field: RoomEditField,
  value: string | number,
): RouteStatePatch[] => {
  const key = roomEditKey(region.guid, field);
  // A designation no person chose has no baseline: staging the same role confirms it as a person's.
  const held = field === "role" && region.designation !== "person" ? undefined : region[field];
  return transitionPatches(["edits"], key, cells[key] ?? {}, {
    kind: "stage",
    rung: { value },
    ...(held === null || held === undefined || held === "" ? {} : { baseline: { value: held } }),
  });
};

/** A field as the cell shows it: Revit's null is empty, never "null". */
const shown = (value: string | number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

const VERDICT_TONE = {
  zone: undefined,
  locked: undefined,
  stale: "caution",
  held: undefined,
  machine: undefined,
} as const;

export function RoomsTable({
  rows,
  cells,
  wire,
  onSelect,
  empty,
}: {
  rows: readonly RoomRow[];
  cells: Cells;
  wire: CellWire;
  onSelect: (guids: ReadonlySet<string>) => void;
  empty: { says: string; exit: string };
}) {
  const doc = useContext(AttentionDocument) ?? "";
  const attention = useAttention(doc);
  const selected = new Set(
    rows
      .filter((row) => attention.selected.has(elementKey(row.region.elementId)))
      .map((row) => row.region.guid),
  );
  const hovered =
    rows.find((row) => attention.hovered.has(elementKey(row.region.elementId)))?.region.guid ??
    null;
  const columns = useMemo<Column<RoomRow>[]>(() => {
    const zoneLabels = new Map(
      // A zone that flipped to a room is its own zone.
      rows
        .filter((row) => row.region.role === "zone" || row.region.zone === row.region.guid)
        .map((row) => [row.region.guid, row.label]),
    );
    const zoneOf = (region: RoomsRegion) =>
      region.role === "zone"
        ? ""
        : ((region.zone == null ? undefined : zoneLabels.get(region.zone)) ?? "unassigned");
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
          currentValue: held || "(blank)",
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
        key: "zone",
        label: "zone",
        title: "the zone this region belongs to; unassigned rooms are outside every zone",
        width: "w-24",
        sort: (row) => zoneOf(row.region),
        facet: (row) => zoneOf(row.region) || "—",
        cell: (row) => (
          <span className="block truncate px-(--item-pad-x)">{zoneOf(row.region) || "—"}</span>
        ),
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
        key: "role",
        label: "role",
        title: "room or zone; a person's choice locks it, else partition inferred it from walls",
        width: "w-20",
        facet: (row) => row.region.role,
        options: ROLES.map((role) => ({ value: role, label: role })),
        cell: (row) => {
          if (row.region.role === "held")
            return <span className="block px-(--item-pad-x)">held</span>;
          const key = roomEditKey(row.region.guid, "role");
          const cell = cells[key];
          const value = shown(cell?.staged?.value ?? row.region.role);
          return (
            <CellListSelect<Role>
              aria-label={`${row.label} role`}
              value={value}
              display={cell?.staged ? <b>{value}</b> : value}
              title={
                cell?.staged
                  ? `staged · Revit holds ${row.region.role}`
                  : `${row.region.designation ?? "machine"} designation`
              }
              items={ROLES}
              keyOf={(role) => role}
              labelOf={(role) => role}
              empty="no roles"
              select="single"
              selected={[value]}
              onPick={(role) => void stage(row.region, "role", role)}
              row={(role) => ({ label: role })}
            />
          );
        },
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
        width: "w-28",
        verdict: (row): Verdict => {
          const state = regionState(row.region);
          return lockedStale(row.region)
            ? {
                word: "locked · stale",
                tone: VERDICT_TONE.stale,
                note: `${REGION_INK.locked.says}; ${REGION_INK.stale.says}`,
              }
            : { word: state, tone: VERDICT_TONE[state], note: REGION_INK[state].says };
        },
      },
    ];
  }, [cells, wire, rows]);

  // The table is a collection like any list (SURFACE-PHILOSOPHY N3): one search, "/" focuses it.
  const [state, setState] = useState<TableState>({ sorts: [], query: "" });
  const rowKey = (row: RoomRow) => row.region.guid;
  const visibleKeys = useMemo(
    () => visibleRows(rows, columns, state).map(rowKey),
    [rows, columns, state],
  );
  return (
    <TableFrame
      label="room regions"
      rows={rows}
      columns={columns}
      rowKey={rowKey}
      state={state}
      onStateChange={setState}
      search
    >
      <Table
        label="room regions"
        rows={rows}
        columns={columns}
        rowKey={rowKey}
        state={state}
        onStateChange={setState}
        visibleKeys={visibleKeys}
        selection={{ selected, onChange: onSelect }}
        activeKey={hovered}
        subject={(row) => ({ doc, key: `room:${row.region.guid}` })}
        empty={
          rows.length ? (
            <EmptyState story="filter" exit="clear the search">
              the search hid all {rows.length} regions
            </EmptyState>
          ) : (
            <EmptyState story="scope" exit={empty.exit}>
              {empty.says}
            </EmptyState>
          )
        }
      />
    </TableFrame>
  );
}
