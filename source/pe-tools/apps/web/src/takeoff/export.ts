/**
 * Pipeline step 6 (export) — the web side of the surgical `.r10` sync.
 *
 * The route stages edits client-side and posts them to /api/takeoff/export, which copies the
 * target and runs eval/rhvac/sync-rhvac.ps1 (copy → validate → atomic swap + timestamped
 * backup, refuses while RHVAC holds the file). This module owns only the shapes and the
 * extract → export-lane room mapping.
 */
import type { RhvacExtract, RhvacRoom } from "#/rhvac/types";

/** Staged edits — client-side until Export runs. The `.r10` is the home; this is a proposal. */
export interface StagedRoomEdit {
  identifier: number;
  name?: string;
  areaSquareFeet?: number;
}

export interface ExportRequest {
  /** Host-visible .r10 path. The route always works on a COPY under a scratch directory. */
  sourcePath: string;
  /** Room payloads in the export lane's shape (see toExportRoom). */
  updates: unknown[];
  /** Validate and leave the copy in place without swapping. */
  whatIf: boolean;
}

export interface ExportResponse {
  ok: boolean;
  /** The scratch copy the sync actually ran against — the fixture is never touched. */
  workingTarget: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  backupPath: string | null;
}

const assembly = (name: string, uValue: number) => ({ Name: name, UValue: uValue });

/**
 * Extract room (camelCase, flat glass/doors with 1-based wallReference) → the export lane's
 * `RhvacRoom` shape (PascalCase, openings nested under their host wall, direction as an int).
 * The lane rewrites only the modeled columns, so the full room must be supplied even when one
 * field changed — anything omitted here would be written as empty, not left alone.
 */
export function toExportRoom(room: RhvacRoom, edit?: StagedRoomEdit) {
  return {
    Identifier: room.identifier,
    Number: room.number,
    Name: edit?.name ?? room.name,
    AreaSquareFeet: edit?.areaSquareFeet ?? room.areaSquareFeet,
    CeilingHeightFeet: room.ceilingHeightFeet,
    SystemNumber: room.systemNumber,
    ZoneNumber: room.zoneNumber,
    InternalLoads: {
      People: room.people,
      LightingWatts: room.lightingWatts,
      SensibleEquipmentBtuh: room.equipmentSensibleBtuh,
      LatentEquipmentBtuh: room.equipmentLatentBtuh,
    },
    Floors: room.floors.map((f) => ({
      Assembly: assembly(f.assembly, f.uValue),
      AreaSquareFeet: f.areaSquareFeet,
      ExposedPerimeterFeet: f.exposedPerimeterFeet,
    })),
    Roofs: room.roofs.map((r) => ({
      Assembly: assembly(r.assembly, r.uValue),
      AreaSquareFeet: r.areaSquareFeet,
      AreaMultiplier: r.areaMultiplier,
    })),
    Walls: room.walls.map((w) => ({
      Assembly: assembly(w.assembly, w.uValue),
      LengthFeet: w.lengthFeet,
      HeightFeet: w.heightFeet,
      Direction: w.direction,
      Windows: room.glass
        .filter((g) => g.wallReference === w.index1)
        .map((g) => ({
          Assembly: assembly(g.assembly, g.uValue),
          WidthFeet: g.widthFeet,
          HeightFeet: g.heightFeet,
          SolarHeatGainCoefficient: g.shgc,
          Occurrences: g.occurrences,
        })),
      Doors: room.doors
        .filter((d) => d.wallReference === w.index1)
        .map((d) => ({
          Assembly: assembly(d.assembly, d.uValue),
          WidthFeet: d.widthFeet,
          HeightFeet: d.heightFeet,
        })),
    })),
  };
}

export async function runExport(request: ExportRequest): Promise<ExportResponse> {
  const response = await fetch("/api/takeoff/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = (await response.json()) as ExportResponse & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `export failed (${response.status})`);
  return body;
}

// ── Step 7: reconcile (report only, writes nothing) ─────────────────────────

export interface ReconcileRow {
  tag: string;
  /** GUID in the System registry, or null when the .r10 knows a system Revit does not. */
  registryGuid: string | null;
  /** SystemNumber in the .r10, or null when the registry knows a System the .r10 does not. */
  rhvacSystemNumber: number | null;
  rooms: number;
}

/**
 * The tag join: registry Systems against the `.r10`'s Systems. RHVAC has no tag column — the
 * convention is that the exported System name carries the tag, and this extract predates that,
 * so the join can only be made on SystemNumber-as-string today. Divergences are listed; nothing
 * is written, ever (README step 7).
 */
export function reconcileRows(
  registryTags: { guid: string; tag: string }[],
  extract: RhvacExtract | null,
): ReconcileRow[] {
  const roomsBySystem = new Map<number, number>();
  for (const room of extract?.rooms ?? [])
    roomsBySystem.set(room.systemNumber, (roomsBySystem.get(room.systemNumber) ?? 0) + 1);

  const rows: ReconcileRow[] = registryTags.map((entry) => ({
    tag: entry.tag,
    registryGuid: entry.guid,
    rhvacSystemNumber: null,
    rooms: 0,
  }));
  for (const system of extract?.systems ?? [])
    rows.push({
      tag: `System ${system.number}`,
      registryGuid: null,
      rhvacSystemNumber: system.number,
      rooms: roomsBySystem.get(system.number) ?? 0,
    });
  return rows;
}
