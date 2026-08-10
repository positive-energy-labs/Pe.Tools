/**
 * Derive the pickable assembly catalog from an extract, client-side — the
 * fixture lane's stand-in for the `rhvac.assemblies` op (which reads the .r10
 * assembly tables directly). Distinct by name per envelope kind; uValue (and
 * shgc for glass) ride along so picking an assembly also fixes its U-value.
 */
import type { RhvacAssemblyCatalog, RhvacAssemblyOption, RhvacExtract } from "#/rhvac/types";

export function deriveAssemblyCatalog(extract: RhvacExtract): RhvacAssemblyCatalog {
  const walls = new Map<string, RhvacAssemblyOption>();
  const glass = new Map<string, RhvacAssemblyOption>();
  const doors = new Map<string, RhvacAssemblyOption>();
  const floors = new Map<string, RhvacAssemblyOption>();
  const roofs = new Map<string, RhvacAssemblyOption>();

  const add = (map: Map<string, RhvacAssemblyOption>, option: RhvacAssemblyOption) => {
    if (option.name.length > 0 && !map.has(option.name)) map.set(option.name, option);
  };

  for (const room of extract.rooms) {
    for (const w of room.walls) add(walls, { name: w.assembly, uValue: w.uValue });
    for (const g of room.glass) add(glass, { name: g.assembly, uValue: g.uValue, shgc: g.shgc });
    for (const d of room.doors) add(doors, { name: d.assembly, uValue: d.uValue });
    for (const f of room.floors) add(floors, { name: f.assembly, uValue: f.uValue });
    for (const r of room.roofs) add(roofs, { name: r.assembly, uValue: r.uValue });
  }

  const sorted = (map: Map<string, RhvacAssemblyOption>) =>
    [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    walls: sorted(walls),
    glass: sorted(glass),
    doors: sorted(doors),
    floors: sorted(floors),
    roofs: sorted(roofs),
  };
}
