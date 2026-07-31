# RHVAC .r10 file format and export lane

Everything below was reverse-engineered from real files and verified twice: a synthetic full room
round-tripped through Elite RHVAC itself (Belmont probe, 2026-07), and a clean decode of all 150
rooms of the firm's most complex project (projectA, 2026-07-24). Treat this file as the format
authority; the throwaway probe scripts it distills lived in `.artifacts/tmp/rhvac-probe/`.

## The container: Access 97 Jet database — 32-bit only

An `.r10` file is a **Jet 3.5 (Access 97) MDB** (`Standard Jet DB`, version byte 0x00) — including
files RHVAC writes today. Consequences:

- The 64-bit ACE driver **cannot open them** ("created with a previous version"). Only the 32-bit
  Jet driver `{Microsoft Access Driver (*.mdb)}` works, which means **every I/O touch runs in a
  32-bit process** (`C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe`). It can never run
  in-proc in 64-bit Revit or the 64-bit test runner — hence the JSON handoff to `export-rhvac.ps1`.
- Connection string: `Driver={Microsoft Access Driver (*.mdb)};Dbq=<path>;Uid=Admin;Pwd=;`

Tables: `Room` (one row per room), `DefaultRoom` (single template row for inserts), `System`,
`Project`, `OutdoorDesign`, `Results`, plus duct/report tables. **There is no material catalog
table** — every Room row carries its full material payload inline.

## The blob encoding (VB6 variant arrays)

Per-category room data (walls, floors, roofs, glass, doors) is stored as parallel LONGBINARY
columns, each one a serialized VB6 variant array:

```
offset 0   int32   count - 1
offset 4   uint16  variant type: 0x2003 int32 | 0x2004 float32 | 0x2008 string | 0x200B int16 (bool)
offset 6   uint16  1  (array flag)
offset 8   int32   count
offset 12  int32   0
offset 16  ...     payload, per variant type; strings are uint16 byte-length prefix + ANSI bytes
```

Scalar fallback (seen alongside arrays in real files): ANSI text `<vbType>q<value>`, e.g. `8q` is
an empty string, `3q5` the int 5. Write the array form; read both.

Real-file quirks the reader must tolerate (project-a evidence):

- Parallel arrays are **not equally sized**: trailing values get trimmed and per-row columns can
  hold a single value that applies to all rows (`WallCategory=[12]` against 5 walls). When cloning
  a seed row at index i, read `min(i, count-1)`.
- Zero rows are meaningful placeholders: "no exposure" is a row of zeros, and engineers keep
  zero-length wall rows mixed between real ones.
- A floor row with area 0 but perimeter > 0 is real (slab-edge loss only).

## Room-row semantics (firm conventions, all verified)

| RHVAC field | Convention |
|---|---|
| `Length`, `Width` | area × 1 — `Length` = room sf, `Width` = 1. Never real dimensions. |
| `Height` | volume-preserving average; the sloped-ceiling fields are unused (0/150 rooms). |
| `FloorLength/Width/Perimeter` | area × 1 per row; perimeter = exposed slab edge. |
| `RoofLength/Width` | plan area × pitch allowance — width holds 1.2 (under roof) or 1.0 (flat). |
| `WallLength/Height/Direction` | the exception: real length × height; direction codes 0=N..7=NW clockwise. |
| `GlassReference`, `DoorReference` | **1-based wall ordinals**; 0 on placeholder rows. |
| `GlassOccurrences` | exists; **doors have no occurrences column** — repeat rows instead. |
| `Number` vs `Identifier` | `Number` is the engineer-facing room number; `Identifier` is the autonumber PK. They diverge. |

Room scalars written directly: `SystemNumber`, `ZoneNumber`, `PeopleNumber`, `LightingWatts`,
`EquipmentSensible`, `EquipmentLatent`, `Occurrences`, `CalculationMode`.

## Materials

Descriptions are free text (e.g. "R-3 insulated sheathing, R-13 closed cell sprayfoam in a 2x6
wood stud cavity, R-15 Fiberglass batt") repeated inline on every row that uses them, together
with the fields that drive the Manual J math: `*ConstructionMaterial`, `*Category`,
`WallGroupCode`, `RoofCLTDIndex`, `*UValue`, `*STD`, `*WTD`, glass shading fields. The exporter
does not invent these: it finds an existing row in the target file whose description equals
`RhvacAssembly.Name` and clones the code fields from it, overriding only geometry, U-value, SHGC,
references, and occurrences. **The engineer must have used each assembly somewhere in the target
file first.**

## Insert lane (proven in Belmont round-trip, reopened by RHVAC)

1. Copy the target file; never write the engineer's original in place.
2. `INSERT INTO [Room] (Number, Description, <all DefaultRoom columns>) SELECT ... FROM [DefaultRoom]`.
3. `SELECT MAX(Identifier)` for the new PK; update scalars; update category blobs.
4. **Always write all five categories.** `DefaultRoom` is not a clean template — real project files
   carry residual junk in it (projectA: four leftover wall lengths and a floor U-value), which would
   become phantom loads. An empty category gets one explicit zero row (empty description/material,
   zero U/dims/refs), which is exactly how RHVAC represents "no exposure" in real files.
5. **Write LONGCHAR columns (`Description`, `RoomNotesPlainText`) after the blob update**: Jet's
   bulk LONGBINARY update mangles adjacent LONGCHAR values (observed live on both).

## Edit lane (update/delete by PK, proven in the project-a round-trip 2026-07-31)

`export-rhvac.ps1 -EditsJson edits.json -Source original.r10 -Output copy.r10` (same 32-bit lane).
The source is always copied to the output first and the copy edited; the original is never written
in place. `edits.json`:

```
{ "updates": [ <RhvacRoom shape + "Identifier": <Room autonumber PK>> ], "deletes": [ <PK> ] }
```

- **Target by `Identifier`** (the autonumber PK from the extract), never by `Number` — they diverge.
- **Update rewrites only the modeled columns**: `Number`, `Description`, `SystemNumber`,
  `ZoneNumber`, `Length`/`Width` (area × 1), `Height`, `PeopleNumber`, `LightingWatts`,
  `EquipmentSensible`, `EquipmentLatent`, and the five category blob groups. Every other column —
  stored loads, `Occurrences`, `CalculationMode`, notes — stays untouched: the file remains truth
  for everything the editor does not model. `RoomNotes`/`RoomNotesPlainText` are read before the
  blob write and rewritten verbatim after it (the Jet LONGCHAR-mangling trap below), verified with
  planted notes.
- **Assemblies work like the insert lane**: the assembly `Name` must already be used somewhere in
  the file; Manual-J code fields are cloned from the first row (in `Identifier` order) using that
  description. An update therefore re-normalizes a row's material code fields to that seed row —
  description and U-value are the editor's truth, the invisible code fields follow the seed.
- **Blob regeneration compacts ordinals**: zero placeholder rows mixed between real walls are not
  reproduced, so glass/door wall references are renumbered to the compacted 1..N order the editor
  sent. Projection-stable for rooms without padding; rooms with padding re-extract with compacted
  ordinals.
- **Delete semantics** (schema investigated on projectA): the only table referencing rooms is
  `TabularManualDDuctsize` — `RoomIdentifier` (int) plus `ReturnRunoutRoomIdentifiers` (a comma
  list), both by Identifier. Delete refuses with a clear error if any duct-sizing row references
  the room (detach it in RHVAC first); otherwise `DELETE FROM [Room]` is clean. `Results`/`System`
  hold building/system aggregates with no room references — they simply go stale until RHVAC
  recalculates, like after any edit. `General.LastVisitedRoom` is a UI cursor and is left alone.
  Deleted rooms leave a gap in `Number`; renumbering is the engineer's call, not the exporter's.
- Jet gotcha: `Number` is a reserved word in `UPDATE ... SET` — always write `[Number]`.

Runnable proof: `eval/rhvac/edit-check.ps1` (any shell; it spawns the 32-bit lane) round-trips the
real project-a file — extract → edit one room's area + a wall length + a glass width, delete one room
→ re-extract → asserts the projection diff is exactly the intended changes and all other rooms,
systems, and building totals are projection-identical.

## Assemblies listing (the editor's picker)

`extract-rhvac.ps1 -Path project.r10 -Output assemblies.json -Assemblies` emits the distinct
assembly names per category (floors/roofs/walls/glass/doors) with their U-values (glass: + SHGC),
first occurrence in Identifier order — the same seed row the export/edit lanes clone code fields
from. The editor only offers these; it never invents assemblies.

## Stored calculation results (the eval oracle)

Real files persist RHVAC's last calculation, all SQL-queryable (verified on projectA, 150 rooms /
42 systems):

- **Room**: `CFMSupplyCooling/Heating/Actual`, `TemperatureInDuct`, `RegistersCalculated`.
- **System**: full `Calculated*` breakdown — cooling sensible/latent/net/recommended (average and
  peak), rooms-only gains, ventilation/supply CFM, heating equivalents.
- **Results**: building totals — `BuildingHeatingLoad`, `BuildingCoolingLoadNet/Recommended`, area.

There is **no headless calculation entry point**: the registered COM surface (`Rhv8PrjFv10.*`,
`RhvExtra10.*`) is the file/record model plus UI-coupled editors — `HTM*`/`GrandTotal*` members
are storage the app fills, and `Rhvac10.exe` registers no automation server and takes no calc CLI
switches. Recomputing loads for a modified file requires opening it in RHVAC (which recalculates)
and saving. Design evals accordingly: inputs compare offline; true load recalc is app-in-the-loop.

## Eval harness

Fixtures live at `eval/rhvac/<project>/` (repo root): `oracle.extract.json` (the extract of the
engineer's calculated file), `oracle.source.txt` (path to that file), `room-map.json` (curated
matches/skips), `tolerances.json` (named profiles: bootstrap/standard/stamp). A takeoff under eval
commits `takeoff/rooms_*.tsv`; the eval runner converts them to the gitignored
`candidate.rooms.json` inspection artifact and `scorecard.*` outputs. Only the oracle, curation,
conventions, and TSV snapshot are fixtures. `RhvacEval.Score` matches candidates to oracle rooms
(explicit map first, then level-constrained area auto-match) and gates per profile;
`RhvacEvalTests` self-verifies the scorer against the project-a oracle. Two loops: the inner loop
scores takeoff inputs against the oracle extract without a live model; the outer loop — true load
recalc — means opening the exported file in RHVAC, and stays manual (see above).

The whole inner loop, from a connected Revit session with the model open:

```
# 1. takeoff all levels -> committed TSV snapshot (selectors: pe-revit service list)
python eval/rhvac/run-takeoff.py --port <hostPort> --session <bridgeSessionId> --project project-a --levels "Lower Level" "Main Level" "Upper Level" "Attic"
# 2. score it (writes eval/rhvac/project-a/scorecard.{json,txt}; fails while gates fail)
dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --filter "FullyQualifiedName~RhvacProjectAEvalRun" -v q --nologo
```

Iterating on detection code: hot-reload via the live converge session, re-run step 1 with
`--detect-only` (seed views survive), re-score. `PE_EVAL_PROFILE=standard|stamp` tightens gates.

### Envelope conversion (v1)

`RhvacCandidateBuilder` converts the committed takeoff snapshot into envelope rooms offline:
inputs are `eval/rhvac/<project>/takeoff/rooms_*.tsv` (the `ToTsv` payloads, one per level) plus
`conventions.json` (true north angle, slab levels, the four assembly slots, roof pitch multiplier,
probe/raster/threshold knobs). `RhvacProjectAEvalRun` builds candidates from these and scores them;
`candidate.rooms.json` is now a gitignored inspection artifact, not an input. Three heuristics:

- **Probe-based exterior classification**: each outer-loop edge probes outward (right-hand normal
  of the CCW loop) at `wallProbeFeet`; the edge is exterior iff the probe lands in no other room
  on the level.
- **One wall per direction**: exterior length is summed into the 8 compass buckets (after the
  true-north rotation) and emitted as one length x mean-ceiling wall per direction — the firm's
  audit-friendly entry style; the scorer compares per-direction area.
- **Uncovered-fraction floors/roofs**: a `coverageCellFeet` raster of the room checks whether cell
  centers are covered by the level immediately below (floors) / above (roofs, topmost = fully
  uncovered); fractions over `uncoveredFractionThreshold` emit that uncovered area. Slab levels
  get full-area slab floors with the exterior edge length as exposed perimeter.

Known v1 gaps: no glass/door detection; hole boundaries ignored for walls (courtyards assumed
enclosed); coverage is adjacent-level-only, so split levels like Landing misattribute; areas are
raw finish-face (no centerline convention yet); assembly names are project defaults, not per-wall
truth.

## This folder

- `RhvacRoom.cs` — the C# contract takeoff producers build and validate against.
- `export-rhvac.ps1` — the JSON → .r10 engine: insert lane (`-RoomsJson`/`-Template`) and edit
  lane (`-EditsJson`/`-Source`, see "Edit lane"). Must run 32-bit; the header documents both JSON
  contracts (System.Text.Json defaults of `RhvacRoom[]`: PascalCase, enums as ints).
- `extract-rhvac.ps1` — the .r10 → JSON oracle extractor: per-room inputs including the
  `identifier` PK (zero placeholder rows dropped, trimmed parallel arrays normalized) plus the
  stored loads above; `-Assemblies` for the distinct-assembly listing. 32-bit lane.

Both scripts are also exposed as host local ops (`rhvac.open` / `rhvac.assemblies` /
`rhvac.save` / `rhvac.takeoff`, dev-lane hosts only) — see
`source/pe-tools/apps/host/src/rhvac-ops.ts`; the `/rhvac` web editor calls them.

Residual gap: automated verification stops at SQL read-back of the written file. "RHVAC opens and
calculates it" was proven manually for the Belmont probe room and stays a manual check per export.
