# Manual E2E runbook — template-populate

The release gate on a new model: adopt preexisting Zone Regions → capture →
partition → review → enter data → sync (INSERT-dominant) into a copy of the firm template
`.r10`. Opening the result in RHVAC is useful follow-up, not part of this gate. Decisions and open
shims behind the run are in `LEDGER.md`.

## Preconditions (check before burning the run)

1. **Revit year**: confirm the model's Revit version. The zone/FR conventions target 2025-era
   tooling; Revit 2026 changed Zone tools — stop and review before using a 2026 model.
2. **Template copy**: copy
   `G:\Shared drives\PE Team Folder\00 PE Folder Template\02_Mechanical\ManJ_Architect_Project_YYYY.MM.DD.r10`
   to a working name on a host-visible path.
   NEVER target the template itself. Known contents (extracted 2026-08-14): 1 blank room
   (Number 1 / Identifier 1), 2 unnamed systems, one floor assembly (22A-pm). RHVAC's material
   picker is app-level — the file itself has near-zero cloneable assemblies; the preset catalog
   shim covers the gap, uncovered assemblies land as zero rows (flagged).
3. **Dev lane up**: the target model is open in the dev Revit session and `vp run dev` is running
   from `source/pe-tools`. Use the dynamic host URL printed by the command. Only one
   take-over-host process at a time.

## The run

1. **Target**: open `/takeoffs`, pick the intended session on the target gate (the `?target=`
   selector uses the same grammar as the chat sentence).
2. **Adopt**: header → "adopt zones" → pick the zoning-plan view (FR-bearing views sort first)
   → check the designer-drawn regions that are zones → name each, type its system tag → stamp.
   Legends are reference-only. Re-open and re-adopt to fix names/tags — stamps are idempotent.
3. **Capture**: select a zone → peek rail → "capture level". Two script phases (prepare =
   WriteTransaction seed views; detect = ReadOnly export + heightfield). Writes
   `replay_<level>.bin` under `Documents\Pe.Tools\takeoff`. Repeat per level.
4. **Partition**: per zone → "partition zone". Materializes Room Regions + held residue into
   the zoning view; rerun never overwrites. Check the accounting-closure card — every declared
   foot accounted or the residue says why.
5. **Review**: work the calls (a/d or the peek buttons). Each verb writes through to the Room
   Region blob before the UI shows it decided (chip says so).
6. **Data**: enter Manual J numbers in the table (cells are always editable; entering data is
   what moves a room to "data entered"). Session-ephemeral until sync — don't close the tab.
7. **Sync**: header → "sync .r10" → paste the working-copy path → confirm the system tags and
   rooms → sync. Room numbers are allocated above the current maximum. System tags resolve by name
   against existing `.r10` Systems; missing Systems are seeded only on the untouched first-run
   template. Result reports inserted identifiers, backup path, and assembly fallbacks. Every receipt
   is validated before the `{file identity, room Identifier}` links are written to all Room Region
   blobs in one Revit transaction; rooms flip to "in .r10".
8. **Optional RHVAC proof (no headless calc exists)**: header → "open in RHVAC".
   Verify: rooms present with correct areas/loads; systems named; Load Preview runs; save;
   re-extract if paranoid (`extract-rhvac.ps1`) and confirm inputs round-trip.
9. **Reload proof**: refresh the browser, re-target — adopted zones, materialized rooms,
   decisions, detector flags, room types, and .r10 links must all survive (they live on FRs/blobs
   and the `PE_M___RoomType` FR parameter). Accepted identity re-binds by geometry.

## Stop conditions

- Any script error mid-run: the error banner shows the first diagnostic — fix, don't retry
  blind. A law-break in PromoteZone throws by design.
- `.r10` locked (RHVAC open on it): sync refuses; close RHVAC first.
- Exposures: the minimal lane creates floor + roof rows and one wall per Room Region polygon edge.
  Glass and doors remain empty (open shim, see LEDGER Owed).
