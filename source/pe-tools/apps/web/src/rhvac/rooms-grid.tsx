/**
 * /rhvac rooms grid — all rooms in one dense hairline table. Sortable headers,
 * name/number filter + system filter, row click focuses the detail panel,
 * checkbox selection feeds bulk system reassignment and bulk delete.
 * Scalar cells edit inline (commit-on-blur); calc'd cfm columns are read-only
 * and dim once anything is edited (stale until RHVAC re-runs its calc).
 */
import { memo, useMemo, useRef, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { fmtNum, NumberCell, TextCell } from "#/rhvac/cells";
import type { BulkAssignPatch } from "#/rhvac/editor";
import type { RhvacRoom, RhvacSystem } from "#/rhvac/types";
import { cn } from "#/lib/utils";

type SortKey =
  | "number"
  | "name"
  | "systemNumber"
  | "areaSquareFeet"
  | "ceilingHeightFeet"
  | "cfmCooling"
  | "cfmHeating";

const sortValue = (room: RhvacRoom, key: SortKey): number | string => {
  if (key === "cfmCooling") return room.loads.cfmSupplyCooling;
  if (key === "cfmHeating") return room.loads.cfmSupplyHeating;
  return room[key];
};

export interface RoomsGridProps {
  rooms: RhvacRoom[];
  systems: RhvacSystem[];
  dirtyIds: ReadonlySet<number>;
  deleted: ReadonlySet<number>;
  selectedIds: ReadonlySet<number>;
  focusedId: number | null;
  loadsStale: boolean;
  onToggleSelect: (identifier: number) => void;
  onSetSelection: (identifiers: ReadonlySet<number>) => void;
  onFocus: (identifier: number) => void;
  onPatchRoom: (identifier: number, patch: Partial<RhvacRoom>) => void;
  onBulkAssign: (identifiers: ReadonlySet<number>, patch: BulkAssignPatch) => void;
  onDelete: (identifiers: number[]) => void;
  onUndelete: (identifier: number) => void;
}

export function RoomsGrid(props: RoomsGridProps) {
  const { rooms, systems, selectedIds, onSetSelection } = props;
  const [filter, setFilter] = useState("");
  const [systemFilter, setSystemFilter] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "number", desc: false });

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = rooms;
    if (q)
      list = list.filter(
        (room) => room.name.toLowerCase().includes(q) || String(room.number).includes(q),
      );
    if (systemFilter !== null) list = list.filter((room) => room.systemNumber === systemFilter);
    const { key, desc } = sort;
    return [...list].sort((a, b) => {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      const cmp =
        typeof va === "string" || typeof vb === "string"
          ? String(va).localeCompare(String(vb))
          : va - vb;
      return desc ? -cmp : cmp;
    });
  }, [rooms, filter, systemFilter, sort]);

  const allVisibleSelected =
    visible.length > 0 && visible.every((room) => selectedIds.has(room.identifier));

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, desc: s.key === key ? !s.desc : false }));

  const Th = ({
    label,
    sortKey,
    right,
    title,
  }: {
    label: string;
    sortKey?: SortKey;
    right?: boolean;
    title?: string;
  }) => (
    <th
      className={cn(
        "sticky top-0 z-10 whitespace-nowrap border-b border-l border-border bg-muted px-1.5 py-1 first:border-l-0",
        right ? "text-right" : "text-left",
      )}
      title={title}
    >
      {sortKey ? (
        <button
          type="button"
          className="tele-label inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
          onClick={() => toggleSort(sortKey)}
        >
          {label}
          {sort.key === sortKey && <span>{sort.desc ? "↓" : "↑"}</span>}
        </button>
      ) : (
        <span className="tele-label text-muted-foreground">{label}</span>
      )}
    </th>
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter rooms by name / number…"
          className="h-7 max-w-64"
        />
        <select
          value={systemFilter === null ? "" : String(systemFilter)}
          onChange={(e) => setSystemFilter(e.target.value === "" ? null : Number(e.target.value))}
          className="tele h-7 rounded-[var(--radius)] border border-border bg-transparent px-1 text-muted-foreground outline-none hover:bg-input/50"
          title="Filter by system"
        >
          <option value="">all systems</option>
          {systems.map((s) => (
            <option key={s.number} value={s.number}>
              sys {s.number}
            </option>
          ))}
        </select>
        <span className="tele text-muted-foreground">
          {visible.length}/{rooms.length} rooms
        </span>
        {selectedIds.size > 0 && (
          <BulkBar
            selectedIds={selectedIds}
            onBulkAssign={props.onBulkAssign}
            onDelete={props.onDelete}
            onClear={() => onSetSelection(new Set())}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky top-0 z-10 border-b border-border bg-muted px-1.5 py-1">
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--primary)]"
                  checked={allVisibleSelected}
                  title="Select all visible"
                  onChange={() => {
                    const next = new Set(selectedIds);
                    if (allVisibleSelected) for (const r of visible) next.delete(r.identifier);
                    else for (const r of visible) next.add(r.identifier);
                    onSetSelection(next);
                  }}
                />
              </th>
              <Th label="#" sortKey="number" right />
              <Th label="name" sortKey="name" />
              <Th label="sys" sortKey="systemNumber" right />
              <Th label="area sf" sortKey="areaSquareFeet" right />
              <Th label="ceil ft" sortKey="ceilingHeightFeet" right />
              <Th label="ppl" right />
              <Th label="ltg W" right />
              <Th label="eq S" right title="equipment sensible Btuh" />
              <Th label="eq L" right title="equipment latent Btuh" />
              <Th
                label={props.loadsStale ? "cfm C ∗" : "cfm C"}
                sortKey="cfmCooling"
                right
                title="supply CFM cooling — as of last RHVAC calc"
              />
              <Th
                label={props.loadsStale ? "cfm H ∗" : "cfm H"}
                sortKey="cfmHeating"
                right
                title="supply CFM heating — as of last RHVAC calc"
              />
              <Th label="state" />
              <Th label="" />
            </tr>
          </thead>
          <tbody>
            {visible.map((room) => (
              <GridRow
                key={room.identifier}
                room={room}
                dirty={props.dirtyIds.has(room.identifier)}
                isDeleted={props.deleted.has(room.identifier)}
                selected={selectedIds.has(room.identifier)}
                focused={props.focusedId === room.identifier}
                loadsStale={props.loadsStale}
                onToggleSelect={props.onToggleSelect}
                onFocus={props.onFocus}
                onPatchRoom={props.onPatchRoom}
                onDelete={props.onDelete}
                onUndelete={props.onUndelete}
              />
            ))}
          </tbody>
        </table>
        {visible.length === 0 && (
          <p className="p-4 text-center text-xs text-muted-foreground">
            No rooms match the filter.
          </p>
        )}
      </div>
    </section>
  );
}

/** Bulk system reassignment for the checked rows. Blank field = leave unchanged. */
function BulkBar({
  selectedIds,
  onBulkAssign,
  onDelete,
  onClear,
}: {
  selectedIds: ReadonlySet<number>;
  onBulkAssign: (identifiers: ReadonlySet<number>, patch: BulkAssignPatch) => void;
  onDelete: (identifiers: number[]) => void;
  onClear: () => void;
}) {
  const systemRef = useRef<HTMLInputElement>(null);

  const apply = () => {
    const sys = Number.parseInt(systemRef.current?.value ?? "", 10);
    if (!Number.isNaN(sys)) onBulkAssign(selectedIds, { systemNumber: sys });
  };

  return (
    <span className="ml-auto flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--user-line)] bg-[var(--user-tint)] py-0.5 pl-2 pr-1">
      <span className="tele text-muted-foreground">{selectedIds.size} selected</span>
      <input
        ref={systemRef}
        placeholder="sys"
        inputMode="numeric"
        className="tele h-6 w-11 rounded-[var(--radius)] border border-border bg-card px-1 text-right outline-none focus:border-ring"
      />
      <Button size="sm" variant="secondary" onClick={apply}>
        Assign
      </Button>
      <Button size="sm" variant="destructive" onClick={() => onDelete([...selectedIds])}>
        <Trash2 /> Delete
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </span>
  );
}

const numberCell = "border-b border-l border-[var(--line-soft)] p-0";

const GridRow = memo(function GridRow({
  room,
  dirty,
  isDeleted,
  selected,
  focused,
  loadsStale,
  onToggleSelect,
  onFocus,
  onPatchRoom,
  onDelete,
  onUndelete,
}: {
  room: RhvacRoom;
  dirty: boolean;
  isDeleted: boolean;
  selected: boolean;
  focused: boolean;
  loadsStale: boolean;
  onToggleSelect: (identifier: number) => void;
  onFocus: (identifier: number) => void;
  onPatchRoom: (identifier: number, patch: Partial<RhvacRoom>) => void;
  onDelete: (identifiers: number[]) => void;
  onUndelete: (identifier: number) => void;
}) {
  const id = room.identifier;
  const patch = (p: Partial<RhvacRoom>) => onPatchRoom(id, p);
  const loadsClass = cn(
    "tele whitespace-nowrap border-b border-l border-[var(--line-soft)] px-1.5 text-right text-muted-foreground",
    loadsStale && "opacity-50",
  );

  return (
    <tr
      className={cn(
        "h-7 cursor-pointer hover:bg-muted/60",
        focused && "bg-primary/5",
        isDeleted && "opacity-45 line-through",
      )}
      onClick={(e) => {
        // Editing a cell should also focus the room; only select-checkbox and
        // row buttons (delete/undo) are focus-neutral.
        if ((e.target as HTMLElement).closest('input[type="checkbox"],button')) return;
        onFocus(id);
      }}
    >
      <td className="border-b border-[var(--line-soft)] px-1.5 text-center">
        <input
          type="checkbox"
          className="size-3.5 accent-[var(--primary)]"
          checked={selected}
          onChange={() => onToggleSelect(id)}
        />
      </td>
      <td className={cn(numberCell, "w-12")}>
        <NumberCell value={room.number} integer min={1} onCommit={(v) => patch({ number: v })} />
      </td>
      <td className={cn(numberCell, "min-w-44")}>
        <TextCell value={room.name} onCommit={(v) => patch({ name: v })} className="text-left" />
      </td>
      <td className={cn(numberCell, "w-12")}>
        <NumberCell
          value={room.systemNumber}
          integer
          min={1}
          onCommit={(v) => patch({ systemNumber: v })}
        />
      </td>
      <td className={cn(numberCell, "w-20")}>
        <NumberCell
          value={room.areaSquareFeet}
          digits={1}
          min={0}
          onCommit={(v) => patch({ areaSquareFeet: v })}
        />
      </td>
      <td className={cn(numberCell, "w-16")}>
        <NumberCell
          value={room.ceilingHeightFeet}
          digits={2}
          min={0}
          onCommit={(v) => patch({ ceilingHeightFeet: v })}
        />
      </td>
      <td className={cn(numberCell, "w-12")}>
        <NumberCell value={room.people} integer min={0} onCommit={(v) => patch({ people: v })} />
      </td>
      <td className={cn(numberCell, "w-16")}>
        <NumberCell
          value={room.lightingWatts}
          digits={0}
          min={0}
          onCommit={(v) => patch({ lightingWatts: v })}
        />
      </td>
      <td className={cn(numberCell, "w-16")}>
        <NumberCell
          value={room.equipmentSensibleBtuh}
          digits={0}
          min={0}
          onCommit={(v) => patch({ equipmentSensibleBtuh: v })}
        />
      </td>
      <td className={cn(numberCell, "w-16")}>
        <NumberCell
          value={room.equipmentLatentBtuh}
          digits={0}
          min={0}
          onCommit={(v) => patch({ equipmentLatentBtuh: v })}
        />
      </td>
      <td className={loadsClass}>{fmtNum(room.loads.cfmSupplyCooling, 0)}</td>
      <td className={loadsClass}>{fmtNum(room.loads.cfmSupplyHeating, 0)}</td>
      <td className="whitespace-nowrap border-b border-l border-[var(--line-soft)] px-1.5">
        {isDeleted ? (
          <span className="tele text-destructive no-underline">deleted</span>
        ) : dirty ? (
          <span className="tele text-cat-clay">edited</span>
        ) : null}
      </td>
      <td className="border-b border-l border-[var(--line-soft)] px-0.5 text-center">
        {isDeleted ? (
          <Button size="icon-xs" variant="ghost" title="Undo delete" onClick={() => onUndelete(id)}>
            <RotateCcw />
          </Button>
        ) : (
          <Button
            size="icon-xs"
            variant="ghost"
            title="Delete room (staged until save)"
            onClick={() => onDelete([id])}
          >
            <Trash2 />
          </Button>
        )}
      </td>
    </tr>
  );
});
