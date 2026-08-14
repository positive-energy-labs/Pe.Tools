# RHVAC & Manual J reference

Stable external-world facts for the Takeoff package: the Elite RHVAC `.r10` file format, the firm's
Manual J conventions, and the Revit-vs-RHVAC terminology crosswalk. These are reverse-engineered
from real files and verified against the firm's most complex project (projectA, 150 rooms). No
code change invalidates them; the direction in [`AGENTS.md`](../../source/Pe.Revit.Takeoff/AGENTS.md)
does.

## `.r10` container & I/O

An `.r10` is an **Access 97 / Jet 3.5 MDB** (`Standard Jet DB`, version byte 0x00) — even files RHVAC
writes today.

- The 64-bit ACE driver **cannot open it**. Only the 32-bit Jet driver works, so **every I/O touch
  runs in a 32-bit process** (`C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe`) — never
  in-proc in 64-bit Revit or the test runner. Hence the JSON handoff to `export-rhvac.ps1`.
- Connection: `Driver={Microsoft Access Driver (*.mdb)};Dbq=<path>;Uid=Admin;Pwd=;`
- Tables: `Room`, `DefaultRoom` (template row for inserts), `System`, `Project`, `OutdoorDesign`,
  `Results`, plus duct/report tables. **No material catalog table** — every Room carries its full
  material payload inline.
- **No headless calculation exists.** The COM surface (`Rhv8PrjFv10.*`, `RhvExtra10.*`) is the
  file/record model plus UI editors; `Rhvac10.exe` registers no automation server and takes no calc
  CLI switches. True load recalc = open in RHVAC + save. Eval compares inputs offline; load recalc is
  app-in-the-loop.

## Blob encoding

Per-category room data (walls, floors, roofs, glass, doors) is stored as parallel LONGBINARY columns,
each a serialized VB6 variant array:

```
offset 0  int32   count - 1
offset 4  uint16  variant type: 0x2003 int32 | 0x2004 float32 | 0x2008 string | 0x200B int16 bool
offset 6  uint16  1  (array flag)
offset 8  int32   count
offset 12 int32   0
offset 16 ...      payload; strings are uint16 byte-length prefix + ANSI bytes
```

Scalar fallback seen in real files: ANSI text `<vbType>q<value>` (`8q` = empty string, `3q5` = int 5).
Write the array form; read both. Real-file quirks the reader must tolerate:

- Parallel arrays are **not equally sized** — trailing values get trimmed, and a single value can apply
  to all rows (`WallCategory=[12]` against 5 walls). When cloning row i, read `min(i, count-1)`.
- Zero rows are meaningful placeholders — "no exposure" is a row of zeros; engineers keep zero-length
  wall rows mixed between real ones. A floor with area 0 but perimeter > 0 is real (slab-edge loss).

## Room-row semantics (firm conventions, all verified)

| Field | Convention |
|---|---|
| `Length`, `Width` | **area × 1** — `Length` = room sf, `Width` = 1. Never real dimensions. |
| `Height` | volume-preserving average; sloped-ceiling fields unused (0/150 rooms). |
| `FloorLength/Width/Perimeter` | area × 1; perimeter = exposed slab edge. |
| `RoofLength/Width` | plan area × pitch allowance — width holds 1.2 (under roof) or 1.0 (flat). |
| `WallLength/Height/Direction` | **the exception:** real length × height; direction 0=N..7=NW clockwise. |
| `GlassReference`, `DoorReference` | 1-based wall ordinals; 0 on placeholder rows. |
| `GlassOccurrences` | exists; **doors have no occurrences column** — repeat rows instead. |
| `Number` vs `Identifier` | `Number` = engineer-facing room number; `Identifier` = autonumber PK. They diverge. |

Scalars written directly: `SystemNumber`, `ZoneNumber`, `PeopleNumber`, `LightingWatts`,
`EquipmentSensible`, `EquipmentLatent`, `Occurrences`, `CalculationMode`. ~half of real rooms are
interior with explicit zero-placeholder rows.

## Materials

Descriptions are free text repeated inline on every row that uses them, alongside the Manual-J code
fields (`*ConstructionMaterial`, `*Category`, `WallGroupCode`, `RoofCLTDIndex`, `*UValue`, `*STD`,
`*WTD`, glass shading). The exporter never invents these: it finds an existing row whose description
equals the assembly `Name` and clones its code fields, overriding only geometry/U-value/SHGC/refs.
**The engineer must have used each assembly somewhere in the target file first.**

## Insert & edit lanes — traps

- Copy the target first; never write the engineer's original in place.
- **Always write all five categories.** `DefaultRoom` carries residual junk (projectA: leftover wall
  lengths + a floor U-value) that would become phantom loads. An empty category gets one explicit
  zero row.
- **Write LONGCHAR columns (`Description`, `RoomNotesPlainText`) after the blob update** — Jet's bulk
  LONGBINARY update mangles adjacent LONGCHARs (observed live).
- Target edits by `Identifier`, never `Number` (they diverge). `Number` is Jet-reserved in `UPDATE` —
  write `[Number]`.
- **Blob regeneration compacts ordinals** — zero placeholder rows are dropped, so glass/door wall refs
  renumber to compacted 1..N. Projection-stable only for rooms without padding.
- **Delete refs:** only `TabularManualDDuctsize` references rooms (`RoomIdentifier` +
  `ReturnRunoutRoomIdentifiers` comma-list). Delete refuses if a duct-sizing row references the room.
  `Results`/`System` hold aggregates that just go stale until RHVAC recalculates.

## Firm Manual J conventions (automatable rules)

Source: firm's internal Manual J training. Candidates for editor assists:

- **Lighting**: 0.25 W/sf × room area.
- **People**: 2 in primary bedroom, 1 per other bedroom (nowhere else).
- **Equipment loads by room type** ("PE full bath", "PE Powder", "Utility/Laundry", "PE Kitchen",
  "PE Dining Load", "PE electronics"; fridge = 16 cf load; ignore "AE" entries).
- **Zone cap**: sensible gain ≤ 32,000 Btu/hr per zone (equipment constraint) — good UI warning.
- **Ventilation per zone**: OA = (#bedrooms+1)×7.5 cfm + 0.03×sf; exhaust = 25 cfm per WC/bath/laundry
  (min 20 per ASHRAE 62.2-2018); take max(OA, exhaust) rounded up to 10s; infiltration credit OFF.
- **ERV latent**: misc return latent gain = zone ventilation latent gain × −0.5.
- **Setpoints**: heating min 70, cooling max 75 (resilience doctrine); test ACH 3 default, 0.6 passive.
- **Austin code-min fallback materials**: floor 22A-pm U-1.18, roof 18B1-36o U-0.029, wall 12F1-0bw
  U-0.065, glass U-0.35/SHGC-0.25.
- **Zoning**: <2000 sf usually 1 zone; primary suite gets its own; one system per zone, zone number
  stays 1, system name suffix "- IU-[n]"; wine rooms get W/STD both sides (wood-framed floor, 55°F,
  own system); slab-on-grade = exposed perimeter only.

## Revit vs RHVAC terminology

These are distinct object types, **not** progressively larger geometry. Unqualified Room/Zone/System
is ambiguous; qualify the software when it matters.

| Concept | Revit | RHVAC | project-a evidence |
|---|---|---|---|
| Room | Architectural/programmatic bounded area | Atomic Manual J load record | 150 records |
| Space | MEP analytical volume | (no counterpart level) | Revit-side analytical carrier only |
| Zone | Spaces sharing environmental requirements | Rooms grouped within one System | Always Zone 1 within each System |
| System | Connected MEP element network | Load/equipment parent of Zones/Rooms | 42 load/equipment records |
| Filled Region | View-specific 2D detail graphic, no domain semantics | (no counterpart) | The editable sheet graphic |

- RHVAC hierarchy is **Building → System → Zone → Room**. RHVAC `System` ≠ Revit MEP System.
- projectA: 150 rooms, 42 systems, **all `ZoneNumber = 1`** — the RHVAC zone layer is degenerate. The
  colored zoning-sheet polygons visualize *Systems* (and merge several into one legend entry, e.g.
  "System FC-8, FC-13: Great Room"), not Revit Zones/Spaces.
- A Filled Region carries no native Room/Space/Zone role — the semantic role must be stamped
  explicitly (see the Identity law in AGENTS.md).
- **Version caveat**: this targets Revit 2025-era legacy HVAC Zones. Revit 2026 changed Zone tools;
  adopting them needs a separate review.

## Proven capabilities (established facts)

- **Zone FRs are machine-extractable**: all 45 project-a zone polygons pulled via `scripting.execute`
  with view name, FR type, fill color, comments, and boundary loops in model feet.
- **E2E `.r10` round-trip proven**: detector rooms → candidate builder → inserted into a real projectA
  copy → re-extracted projection-equivalent within 0.001, source SHA byte-unchanged.
- **Detection is deterministic**: TSVs reproduce byte-identically across Revit restarts and detector
  refactors (enables an offline replay loop; upstream raster knobs bake at capture).
- **Bluebeam takeoffs are a minable per-room oracle**: 145/150 room areas and 319/328 wall lengths
  match markups within 1–2%; the model frame is project-north-rotated ~130.5°, calibrated
  per-annotation (never trust the page viewport), registered via RANSAC+ICP with a rotation prior.

## Scripts

- `Rhvac/export-rhvac.ps1` — JSON → `.r10` engine: insert lane (`-RoomsJson`/`-Template`) and edit
  lane (`-EditsJson`/`-Source`). 32-bit.
- `Rhvac/extract-rhvac.ps1` — `.r10` → JSON oracle extractor: per-room inputs + the `identifier` PK +
  stored loads; `-Assemblies` for the distinct-assembly picker listing. 32-bit.

Both are also host local ops (`rhvac.open` / `rhvac.assemblies` / `rhvac.save` / `rhvac.takeoff`,
dev-lane only). Automated verification stops at SQL read-back of the written file; "RHVAC opens and
calculates it" is a manual check per export.
