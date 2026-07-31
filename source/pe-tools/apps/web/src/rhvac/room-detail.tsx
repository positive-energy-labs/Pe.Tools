/**
 * /rhvac room detail — the focused room's envelope as editable row tables
 * (walls / glass / doors / floors / roofs) plus its read-only calc loads.
 * Assemblies are pickers over what exists in the file (never free text);
 * picking one also lands its U-value (and SHGC for glass). Glass/door rows
 * reference walls by 1-based ordinal — a reference past the wall list is an
 * inline error state, surfaced per-cell and in a summary line.
 */
import { Plus, Trash2, X } from "lucide-react";

import { Button } from "#/components/ui/button";
import { CellSelect, fmtNum, NumberCell } from "#/rhvac/cells";
import {
  DIRECTIONS,
  type RhvacAssemblyCatalog,
  type RhvacAssemblyOption,
  type RhvacRoom,
  type RhvacSystem,
} from "#/rhvac/types";
import { cn } from "#/lib/utils";

export interface RoomDetailProps {
  room: RhvacRoom;
  system: RhvacSystem | undefined;
  catalog: RhvacAssemblyCatalog | null;
  loadsStale: boolean;
  onMutate: (mutate: (room: RhvacRoom) => RhvacRoom) => void;
  onClose: () => void;
}

export function RoomDetail({
  room,
  system,
  catalog,
  loadsStale,
  onMutate,
  onClose,
}: RoomDetailProps) {
  const wallCount = room.walls.length;
  const badRefs =
    room.glass.filter((g) => g.wallReference < 1 || g.wallReference > wallCount).length +
    room.doors.filter((d) => d.wallReference < 1 || d.wallReference > wallCount).length;

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-border bg-[var(--paper)]">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--line)] px-3">
        <span className="tele text-muted-foreground">#{room.number}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{room.name}</span>
        <Button size="icon-sm" variant="ghost" title="Close detail" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {badRefs > 0 && (
          <p className="rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {badRefs} glass/door row{badRefs === 1 ? "" : "s"} reference a wall ordinal that no
            longer exists — repoint or remove before saving.
          </p>
        )}

        <LoadsSection room={room} system={system} loadsStale={loadsStale} />
        <WallsTable room={room} catalog={catalog} onMutate={onMutate} />
        <GlassTable room={room} catalog={catalog} onMutate={onMutate} />
        <DoorsTable room={room} catalog={catalog} onMutate={onMutate} />
        <FloorsTable room={room} catalog={catalog} onMutate={onMutate} />
        <RoofsTable room={room} catalog={catalog} onMutate={onMutate} />
      </div>
    </aside>
  );
}

/* ── loads (read-only calc outputs) ─────────────────────────────────────────── */

function LoadsSection({
  room,
  system,
  loadsStale,
}: {
  room: RhvacRoom;
  system: RhvacSystem | undefined;
  loadsStale: boolean;
}) {
  const Item = ({ label, value, unit }: { label: string; value: number; unit?: string }) => (
    <div className="flex items-baseline justify-between gap-2">
      <span className="tele-label text-muted-foreground">{label}</span>
      <span className={cn("tele", loadsStale && "text-cat-clay opacity-70")}>
        {fmtNum(value, 0)}
        {unit && <span className="ml-0.5 text-muted-foreground">{unit}</span>}
      </span>
    </div>
  );

  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="section-label">Loads · read-only</h3>
        <span
          className={cn(
            "tele-label rounded-[var(--radius)] border px-1.5 py-px",
            loadsStale
              ? "border-cat-clay/40 bg-cat-clay/10 text-cat-clay"
              : "border-border text-muted-foreground",
          )}
        >
          {loadsStale ? "stale — run Preview Loads in RHVAC" : "as of last RHVAC calc"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 rounded-[var(--radius)] border border-border bg-card px-2.5 py-2">
        <Item label="cfm cooling" value={room.loads.cfmSupplyCooling} />
        <Item label="cfm heating" value={room.loads.cfmSupplyHeating} />
        <Item label="cfm actual" value={room.loads.cfmSupplyActual} />
        <Item label="duct temp" value={room.loads.temperatureInDuct} unit="°F" />
        <Item label="registers" value={room.loads.registersCalculated} />
      </div>
      {system && (
        <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 rounded-[var(--radius)] border border-border bg-card px-2.5 py-2">
          <div className="col-span-2 tele-label text-muted-foreground">
            system {system.number} totals
          </div>
          <Item label="cool net pk" value={system.calculatedCoolingNetLoadPeak} unit="Btuh" />
          <Item
            label="cool rec pk"
            value={system.calculatedCoolingRecommendedLoadPeak}
            unit="Btuh"
          />
          <Item label="heating" value={system.calculatedHeatingLoad} unit="Btuh" />
          <Item label="system cfm" value={system.calculatedActualSystemCFM} />
        </div>
      )}
    </section>
  );
}

/* ── envelope table plumbing ────────────────────────────────────────────────── */

function EnvelopeTable({
  title,
  count,
  headers,
  onAdd,
  addDisabledReason,
  children,
}: {
  title: string;
  count: number;
  headers: string[];
  onAdd: () => void;
  addDisabledReason?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="section-label">
          {title}
          <span className="tele ml-1.5 normal-case text-muted-foreground">{count}</span>
        </h3>
        <Button
          size="icon-xs"
          variant="ghost"
          title={addDisabledReason ?? `Add ${title.toLowerCase()} row`}
          disabled={addDisabledReason !== undefined}
          onClick={onAdd}
        >
          <Plus />
        </Button>
      </div>
      <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {headers.map((h) => (
                <th
                  key={h}
                  className="tele-label whitespace-nowrap border-b border-l border-border bg-muted px-1.5 py-1 text-left font-normal text-muted-foreground first:border-l-0"
                >
                  {h}
                </th>
              ))}
              <th className="border-b border-l border-border bg-muted" />
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
        {count === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">none</p>}
      </div>
    </section>
  );
}

const cellTd = "border-b border-l border-[var(--line-soft)] p-0 first:border-l-0";

function RemoveCell({ onRemove, title }: { onRemove: () => void; title: string }) {
  return (
    <td className="border-b border-l border-[var(--line-soft)] px-0.5 text-center">
      <button
        type="button"
        title={title}
        className="text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="size-3" />
      </button>
    </td>
  );
}

/**
 * Assembly picker — options are the assemblies present in the file, plus the
 * row's current value when it isn't in the catalog (so nothing renders blank).
 * No free-text lane on purpose.
 */
function AssemblyCell({
  value,
  options,
  onPick,
}: {
  value: string;
  options: RhvacAssemblyOption[];
  onPick: (option: RhvacAssemblyOption) => void;
}) {
  const known = options.some((o) => o.name === value);
  return (
    <CellSelect
      value={value}
      title={value}
      className="max-w-40"
      onChange={(name) => {
        const option = options.find((o) => o.name === name);
        if (option) onPick(option);
      }}
    >
      {!known && <option value={value}>{value || "(unset)"}</option>}
      {options.map((o) => (
        <option key={o.name} value={o.name} title={`U ${fmtNum(o.uValue, 3)}`}>
          {o.name}
        </option>
      ))}
    </CellSelect>
  );
}

/** Wall ordinal picker for glass/door rows — constrained to existing ordinals. */
function WallRefCell({
  value,
  wallCount,
  onPick,
}: {
  value: number;
  wallCount: number;
  onPick: (ordinal: number) => void;
}) {
  const invalid = value < 1 || value > wallCount;
  return (
    <CellSelect
      value={String(value)}
      invalid={invalid}
      title={invalid ? `wall ${value} does not exist (room has ${wallCount})` : `wall ${value}`}
      onChange={(v) => onPick(Number(v))}
    >
      {invalid && <option value={String(value)}>!{value}</option>}
      {Array.from({ length: wallCount }, (_, i) => (
        <option key={i + 1} value={String(i + 1)}>
          {i + 1}
        </option>
      ))}
    </CellSelect>
  );
}

/* ── the five envelope tables ───────────────────────────────────────────────── */

type Mutator = (mutate: (room: RhvacRoom) => RhvacRoom) => void;

function WallsTable({
  room,
  catalog,
  onMutate,
}: {
  room: RhvacRoom;
  catalog: RhvacAssemblyCatalog | null;
  onMutate: Mutator;
}) {
  const options = catalog?.walls ?? [];
  const setWall = (index: number, patch: Partial<RhvacRoom["walls"][number]>) =>
    onMutate((r) => ({
      ...r,
      walls: r.walls.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    }));

  return (
    <EnvelopeTable
      title="Walls"
      count={room.walls.length}
      headers={["#", "assembly", "len ft", "ht ft", "dir"]}
      onAdd={() =>
        onMutate((r) => ({
          ...r,
          walls: [
            ...r.walls,
            {
              index1: r.walls.length + 1,
              assembly: options[0]?.name ?? r.walls[0]?.assembly ?? "",
              uValue: options[0]?.uValue ?? r.walls[0]?.uValue ?? 0,
              lengthFeet: 10,
              heightFeet: r.ceilingHeightFeet,
              direction: 0,
            },
          ],
        }))
      }
    >
      {room.walls.map((wall, i) => (
        <tr key={i} className="h-7">
          <td className="tele border-b border-[var(--line-soft)] px-1.5 text-right text-muted-foreground">
            {wall.index1}
          </td>
          <td className={cellTd}>
            <AssemblyCell
              value={wall.assembly}
              options={options}
              onPick={(o) => setWall(i, { assembly: o.name, uValue: o.uValue })}
            />
          </td>
          <td className={cn(cellTd, "w-14")}>
            <NumberCell
              value={wall.lengthFeet}
              digits={2}
              min={0}
              onCommit={(v) => setWall(i, { lengthFeet: v })}
            />
          </td>
          <td className={cn(cellTd, "w-14")}>
            <NumberCell
              value={wall.heightFeet}
              digits={2}
              min={0}
              onCommit={(v) => setWall(i, { heightFeet: v })}
            />
          </td>
          <td className={cn(cellTd, "w-14")}>
            <CellSelect
              value={String(wall.direction)}
              title="compass direction"
              onChange={(v) => setWall(i, { direction: Number(v) })}
            >
              {DIRECTIONS.map((d, di) => (
                <option key={d} value={String(di)}>
                  {d}
                </option>
              ))}
            </CellSelect>
          </td>
          <RemoveCell
            title="Remove wall — later walls renumber; glass/doors pointing past the end become errors"
            onRemove={() =>
              onMutate((r) => ({
                ...r,
                walls: r.walls
                  .filter((_, wi) => wi !== i)
                  .map((w, wi) => ({ ...w, index1: wi + 1 })),
              }))
            }
          />
        </tr>
      ))}
    </EnvelopeTable>
  );
}

function GlassTable({
  room,
  catalog,
  onMutate,
}: {
  room: RhvacRoom;
  catalog: RhvacAssemblyCatalog | null;
  onMutate: Mutator;
}) {
  const options = catalog?.glass ?? [];
  const setGlass = (index: number, patch: Partial<RhvacRoom["glass"][number]>) =>
    onMutate((r) => ({
      ...r,
      glass: r.glass.map((g, i) => (i === index ? { ...g, ...patch } : g)),
    }));

  return (
    <EnvelopeTable
      title="Glass"
      count={room.glass.length}
      headers={["assembly", "w ft", "h ft", "wall", "shgc", "U", "×"]}
      addDisabledReason={room.walls.length === 0 ? "Add a wall first" : undefined}
      onAdd={() =>
        onMutate((r) => ({
          ...r,
          glass: [
            ...r.glass,
            {
              assembly: options[0]?.name ?? "",
              uValue: options[0]?.uValue ?? 0.3,
              widthFeet: 3,
              heightFeet: 4,
              wallReference: 1,
              shgc: options[0]?.shgc ?? 0.3,
              occurrences: 1,
            },
          ],
        }))
      }
    >
      {room.glass.map((glass, i) => (
        <tr key={i} className="h-7">
          <td className={cellTd}>
            <AssemblyCell
              value={glass.assembly}
              options={options}
              onPick={(o) =>
                setGlass(i, { assembly: o.name, uValue: o.uValue, shgc: o.shgc ?? glass.shgc })
              }
            />
          </td>
          <td className={cn(cellTd, "w-12")}>
            <NumberCell
              value={glass.widthFeet}
              digits={2}
              min={0}
              onCommit={(v) => setGlass(i, { widthFeet: v })}
            />
          </td>
          <td className={cn(cellTd, "w-12")}>
            <NumberCell
              value={glass.heightFeet}
              digits={2}
              min={0}
              onCommit={(v) => setGlass(i, { heightFeet: v })}
            />
          </td>
          <td className={cn(cellTd, "w-12")}>
            <WallRefCell
              value={glass.wallReference}
              wallCount={room.walls.length}
              onPick={(v) => setGlass(i, { wallReference: v })}
            />
          </td>
          <td className={cn(cellTd, "w-12")}>
            <NumberCell
              value={glass.shgc}
              digits={2}
              min={0}
              onCommit={(v) => setGlass(i, { shgc: v })}
            />
          </td>
          <td className={cn(cellTd, "w-14")}>
            <NumberCell
              value={glass.uValue}
              digits={3}
              min={0}
              onCommit={(v) => setGlass(i, { uValue: v })}
            />
          </td>
          <td className={cn(cellTd, "w-10")}>
            <NumberCell
              value={glass.occurrences}
              integer
              min={1}
              onCommit={(v) => setGlass(i, { occurrences: v })}
            />
          </td>
          <RemoveCell
            title="Remove glass row"
            onRemove={() => onMutate((r) => ({ ...r, glass: r.glass.filter((_, gi) => gi !== i) }))}
          />
        </tr>
      ))}
    </EnvelopeTable>
  );
}

function DoorsTable({
  room,
  catalog,
  onMutate,
}: {
  room: RhvacRoom;
  catalog: RhvacAssemblyCatalog | null;
  onMutate: Mutator;
}) {
  const options = catalog?.doors ?? [];
  const setDoor = (index: number, patch: Partial<RhvacRoom["doors"][number]>) =>
    onMutate((r) => ({
      ...r,
      doors: r.doors.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    }));

  return (
    <EnvelopeTable
      title="Doors"
      count={room.doors.length}
      headers={["assembly", "w ft", "h ft", "wall", "U"]}
      addDisabledReason={room.walls.length === 0 ? "Add a wall first" : undefined}
      onAdd={() =>
        onMutate((r) => ({
          ...r,
          doors: [
            ...r.doors,
            {
              assembly: options[0]?.name ?? "",
              uValue: options[0]?.uValue ?? 0.5,
              widthFeet: 3,
              heightFeet: 7,
              wallReference: 1,
            },
          ],
        }))
      }
    >
      {room.doors.map((door, i) => (
        <tr key={i} className="h-7">
          <td className={cellTd}>
            <AssemblyCell
              value={door.assembly}
              options={options}
              onPick={(o) => setDoor(i, { assembly: o.name, uValue: o.uValue })}
            />
          </td>
          <td className={cn(cellTd, "w-12")}>
            <NumberCell
              value={door.widthFeet}
              digits={2}
              min={0}
              onCommit={(v) => setDoor(i, { widthFeet: v })}
            />
          </td>
          <td className={cn(cellTd, "w-12")}>
            <NumberCell
              value={door.heightFeet}
              digits={2}
              min={0}
              onCommit={(v) => setDoor(i, { heightFeet: v })}
            />
          </td>
          <td className={cn(cellTd, "w-12")}>
            <WallRefCell
              value={door.wallReference}
              wallCount={room.walls.length}
              onPick={(v) => setDoor(i, { wallReference: v })}
            />
          </td>
          <td className={cn(cellTd, "w-14")}>
            <NumberCell
              value={door.uValue}
              digits={3}
              min={0}
              onCommit={(v) => setDoor(i, { uValue: v })}
            />
          </td>
          <RemoveCell
            title="Remove door row"
            onRemove={() => onMutate((r) => ({ ...r, doors: r.doors.filter((_, di) => di !== i) }))}
          />
        </tr>
      ))}
    </EnvelopeTable>
  );
}

function FloorsTable({
  room,
  catalog,
  onMutate,
}: {
  room: RhvacRoom;
  catalog: RhvacAssemblyCatalog | null;
  onMutate: Mutator;
}) {
  const options = catalog?.floors ?? [];
  const setFloor = (index: number, patch: Partial<RhvacRoom["floors"][number]>) =>
    onMutate((r) => ({
      ...r,
      floors: r.floors.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    }));

  return (
    <EnvelopeTable
      title="Floors"
      count={room.floors.length}
      headers={["assembly", "area sf", "exp perim ft", "U"]}
      onAdd={() =>
        onMutate((r) => ({
          ...r,
          floors: [
            ...r.floors,
            {
              assembly: options[0]?.name ?? "",
              uValue: options[0]?.uValue ?? 0.05,
              areaSquareFeet: r.areaSquareFeet,
              exposedPerimeterFeet: 0,
            },
          ],
        }))
      }
    >
      {room.floors.map((floor, i) => (
        <tr key={i} className="h-7">
          <td className={cellTd}>
            <AssemblyCell
              value={floor.assembly}
              options={options}
              onPick={(o) => setFloor(i, { assembly: o.name, uValue: o.uValue })}
            />
          </td>
          <td className={cn(cellTd, "w-16")}>
            <NumberCell
              value={floor.areaSquareFeet}
              digits={1}
              min={0}
              onCommit={(v) => setFloor(i, { areaSquareFeet: v })}
            />
          </td>
          <td className={cn(cellTd, "w-16")}>
            <NumberCell
              value={floor.exposedPerimeterFeet}
              digits={1}
              min={0}
              onCommit={(v) => setFloor(i, { exposedPerimeterFeet: v })}
            />
          </td>
          <td className={cn(cellTd, "w-14")}>
            <NumberCell
              value={floor.uValue}
              digits={3}
              min={0}
              onCommit={(v) => setFloor(i, { uValue: v })}
            />
          </td>
          <RemoveCell
            title="Remove floor row"
            onRemove={() =>
              onMutate((r) => ({ ...r, floors: r.floors.filter((_, fi) => fi !== i) }))
            }
          />
        </tr>
      ))}
    </EnvelopeTable>
  );
}

function RoofsTable({
  room,
  catalog,
  onMutate,
}: {
  room: RhvacRoom;
  catalog: RhvacAssemblyCatalog | null;
  onMutate: Mutator;
}) {
  const options = catalog?.roofs ?? [];
  const setRoof = (index: number, patch: Partial<RhvacRoom["roofs"][number]>) =>
    onMutate((r) => ({
      ...r,
      roofs: r.roofs.map((rf, i) => (i === index ? { ...rf, ...patch } : rf)),
    }));

  return (
    <EnvelopeTable
      title="Roofs"
      count={room.roofs.length}
      headers={["assembly", "area sf", "mult", "U"]}
      onAdd={() =>
        onMutate((r) => ({
          ...r,
          roofs: [
            ...r.roofs,
            {
              assembly: options[0]?.name ?? "",
              uValue: options[0]?.uValue ?? 0.03,
              areaSquareFeet: r.areaSquareFeet,
              areaMultiplier: 1,
            },
          ],
        }))
      }
    >
      {room.roofs.map((roof, i) => (
        <tr key={i} className="h-7">
          <td className={cellTd}>
            <AssemblyCell
              value={roof.assembly}
              options={options}
              onPick={(o) => setRoof(i, { assembly: o.name, uValue: o.uValue })}
            />
          </td>
          <td className={cn(cellTd, "w-16")}>
            <NumberCell
              value={roof.areaSquareFeet}
              digits={1}
              min={0}
              onCommit={(v) => setRoof(i, { areaSquareFeet: v })}
            />
          </td>
          <td className={cn(cellTd, "w-12")}>
            <NumberCell
              value={roof.areaMultiplier}
              digits={2}
              min={0}
              onCommit={(v) => setRoof(i, { areaMultiplier: v })}
            />
          </td>
          <td className={cn(cellTd, "w-14")}>
            <NumberCell
              value={roof.uValue}
              digits={3}
              min={0}
              onCommit={(v) => setRoof(i, { uValue: v })}
            />
          </td>
          <RemoveCell
            title="Remove roof row"
            onRemove={() => onMutate((r) => ({ ...r, roofs: r.roofs.filter((_, ri) => ri !== i) }))}
          />
        </tr>
      ))}
    </EnvelopeTable>
  );
}
