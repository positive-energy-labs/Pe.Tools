# Family Mutation Spike — Shared Pod Foundation (2026-07-04)

Read this once, fully. It is the only shared input across pods. Do NOT read other
pods' workspaces (`fam-desired`, `fam-verbs`, `fam-script` are siblings — stay out of
the two that aren't yours).

## Mission recap

Find the best interface for pea to mutate families across four surfaces:
(a) loaded family in project, (b) placed family instance, (c) open family document,
(d) nested family inside a family document. Your pod has ONE thesis (in your brief).
Build the smallest library + entrypoints that proves it, live, against the proof
battery. Honesty over polish: a proof that fails with a clear reason is a GOOD result.

## Mechanics (verified today)

- Bootstrap: `pea --dev script bootstrap --workspace <your-pod>` creates
  `C:\Users\kaitp\Documents\Pe.Tools\workspaces\<your-pod>\` (PeScripts.csproj, src/,
  evidence/). `pea` shim: `C:\Users\kaitp\AppData\Local\Positive Energy\Pe.Tools\bin\pea\pea.cmd`,
  callable from PowerShell as `pea --dev ...` from any directory.
- Execute: `pea --dev script execute --source-path src\XX.cs --workspace <your-pod>
  --permission-mode WriteTransaction` (or ReadOnly for pure reads). One non-abstract
  `PeScriptContainer` per entrypoint file; helpers in other src files compile too.
- In `Execute()`: `doc` (active Document), `uidoc`, `app` (UIApplication), `selection`,
  `revitVersion`, `WriteLine(...)` (goes to CLI stdout), `Artifacts.WriteJson/WriteCsv/
  WriteText(name, payload)` → `evidence\<executionId>\<name>`. Copy durable evidence up
  to `evidence\pN-*.json` yourself (a helper that writes both places is fine).
- ReadOnly static policy rejects `Document.EditFamily/LoadFamily/Delete`,
  `Parameter.Set`, `FamilyManager` mutations, `Transaction` ctors, reflection Invoke —
  and the scan can cover the whole compiled pod, so expect PolicyRejected on ReadOnly
  runs once your library contains mutation code. Default to WriteTransaction; the host
  owns the transaction (rollback on exception, commit on success). Never open your own
  Transaction.
- Timeouts: script runs ~300 s budget, CLI calls 60–120 s typical. Bridge serializes
  operations; busy = clean rejection → wait 20–45 s, retry; two busies →
  `pea --dev host status` + `pea --dev host logs --target revit --tail 30`. Never
  re-issue an unconfirmed MUTATING run without checking (marker census makes this
  cheap). Scripts are stateless between runs — state lives in the model or workspace
  files. Idempotency: every mutating entrypoint starts by wiping/reconciling its own
  stale marker artifacts.
- Knobs/inputs: your interface's input document(s) live as JSON files in your workspace
  root; scripts read them with `File.ReadAllText` + Newtonsoft. This file IS your
  interface front door (except fam-script, whose front door is the scenario script
  itself).
- Host ops (read side, optional): `pea --dev host operations search --query families`;
  `revit.catalog.loaded-families` and `revit.detail.elements` exist. JSON requests from
  PowerShell need escaped quotes: `--request '{\"key\": \"value\"}'`.

## Referencing Pe.Revit.FamilyFoundry (optional, encouraged for fam-desired)

`Pe.Revit.FamilyFoundry.dll` is already LOADED in the Revit process. For compile-time
reference add to PeScripts.csproj:
`<Reference Include="Pe.Revit.FamilyFoundry"><HintPath>...\Addins\2025\Pe.App\<newest-stamp>\Pe.Revit.FamilyFoundry.dll</HintPath><Private>false</Private></Reference>`
(newest stamp dir under `C:\Users\kaitp\AppData\Roaming\Autodesk\Revit\Addins\2025\Pe.App\`).
If the compile-time API drifts from the loaded assembly you'll see
MissingMethodException at runtime — RECORD it; "engine not reusable from scripting" is
itself a spike finding. Fallback: reimplement the minimal op yourself with the raw
Revit API (FamilyManager, doc.EditFamily, famDoc.LoadFamily).

Key FF facts (from today's survey — verify what you rely on):
- Profiles: `FFManagerProfile` (open fam doc: SharedParameters, FamilyParameters,
  SetLookupTables, ParamDrivenSolids), `FFMigratorProfile` (project bulk: + MappingData,
  PerTypeAssignmentsTable, DeleteParams, source-name mapping), and
  `DesiredFamilyMigrationProfile` (declarative; compiled by `DesiredParameterCompiler`,
  lowered by `DesiredMigrationPlanLowerer` → `CompiledFamilyFoundryOperationProfile`).
- Apply: `Document.ApplyFamilyProfile / ApplyFamilyMigrationProfile /
  ApplyDesiredFamilyMigrationProfile` (extension methods in
  `DocumentFamilyProfileApplyExtensions`); `OperationProcessor` routes fam-doc vs
  project (EditFamily → pipeline → SaveToPaths → Load → snapshots).
- Real authored profiles: `C:\Users\kaitp\Documents\Pe.Tools\settings\CmdFFMigrator\profiles\`
  and `settings\Global\fragments\` — read a couple; that JSON dialect is the incumbent
  authoring language (param:tokens, PerTypeAssignmentsTable, @-plane refs in
  ParamDrivenSolids).
- ParamDrivenSolids authored shape: Frame/Planes/Spans/Prisms/Cylinders/Connectors with
  `param:<Name>` bindings and `@Bottom/@CenterFB/@CenterLR` refs (see
  `AuthoredParamDrivenSolids.Models.cs`, contract tests in
  `ParamDrivenSolidsJsonContractTests.cs`).
- Artifact idiom worth imitating: run-summary.json / family-report.json /
  snapshot-pre|post|diff.json per family.

## Substrate

Active doc: **Snowdon Towers Sample HVAC** (project; 6 linked siblings also open; do
not touch links). Real loaded families exist (VAVs, air terminals, mech equipment) —
recon them read-only for realism, but MUTATE ONLY YOUR MARKER FAMILIES. The project is
never saved; still, leave the session clean (other agents share it): P7 cleanup is
mandatory and verified.

Family templates: `C:\ProgramData\Autodesk\RVT 2025\Family Templates\English-Imperial\Generic Model.rft`
(plus variants). Save marker family files under your workspace (e.g. `families\`), never
into the model's folder.

Marker convention: every family name, view name, and instance Comments you create
starts with your pod marker (brief). Cleanup censuses by marker. Sibling pods create
families with the SAME param names (`PE_OLD_Width` etc.) — every selector you run must
filter by your marker prefix; a census that counts another pod's families is a bug.

## Proof battery (identical per pod; each proof = evidence artifact + NOTES row)

- **P0 recon (read)**: census loaded families/types/params of the active doc; snapshot
  2 real families' params as reference JSON. Deliverable: `p0-census.json`.
- **P1 seed sandbox (write)**: create marker families `<MARKER>_F1`, `_F2`, `_F3`, and
  `<MARKER>_N1` nested inside F3. Each F-family: ≥2 types; type param `PE_OLD_Width`
  (Length) with distinct per-type values; instance param `PE_FM_Note` (Text); a formula
  param `PE_FM_Depth` = `PE_OLD_Width / 2`. N1 carries its own `PE_OLD_Width`. Load all
  into the project; place ≥2 instances of F1 (tag Comments with marker). Seeding is
  substrate, not interface — dogfooding your interface here is allowed but optional.
  Deliverable: `p1-seed.json` (ids, names, types, values).
- **P2 bulk edit (interface)**: ONE interface input edits all three F-families in one
  run: add param `PE_FM_Batch` (Text, type-level) to all + change `PE_OLD_Width`
  per-type values. Verify by post-census. Deliverable: input doc + `p2-bulk.json`.
- **P3 instance edit (interface)**: in the SAME language, set `PE_FM_Note` on exactly
  one placed instance of F1. Verify the sibling instance and the type are untouched.
  Deliverable: input + `p3-instance.json`.
- **P4 rename+migrate (interface)**: rename `PE_OLD_Width` → `PE_NEW_Width` across
  every family carrying it — expressed as a project-wide selector ("all families with
  param X") but FILTERED to your marker prefix (three pods share this session; the
  other pods' families also carry `PE_OLD_Width` — never touch them). State clearly
  whether N1 inside F3 was reached. Preserve per-type values; `PE_FM_Depth` formula must still
  compute (rewritten to reference the new name). Verify old-gone/new-valued/formula-ok.
  Deliverable: input + `p4-rename.json`.
- **P5 nested (interface)**: through your addressing, mutate N1 *inside* F3 (set its
  `PE_FM_Note` default and/or rename its local param), propagate (F3 reload → project),
  and verify from the project-level snapshot. Deliverable: input + `p5-nested.json`.
- **P6 ParamDrivenSolids bonus (interface)**: apply a minimal solids intent (one prism
  whose width binds `param:PE_NEW_Width`) to F2 on the fly via your front door; verify
  a solid exists and its bbox tracks a `PE_NEW_Width` change. If you reuse FF's PDS
  compiler, say so; if you fake a minimal extrusion instead, say so. Deliverable:
  input + `p6-solids.json` (bbox before/after).
- **P7 cleanup**: delete marker instances, families (incl. nested), views; verify
  census-zero + project family count back to P0 baseline. Deliverable: `p7-cleanup.json`.

## Metrics (record in NOTES.md as you go, not retroactively)

Runs / compile failures per proof; interface inputs per proof (count + a one-line shape
description); refinement loop cost (edits × runs when something needed correcting);
**same-language score**: for P2–P6, did the input speak the same addressing + units
grammar (yes/partial/no + why); friction notes (yours, candidly).

## Required outputs

1. `NOTES.md` — substrate facts discovered, proof-status table with evidence links,
   metrics, friction, and a closing **unification verdict**: where your thesis's single
   model held, where it broke, what boundary you'd draw instead.
2. `SKILL.md` (draft) — how pea would use your interface: when-to-use, the operating
   loop, input examples for each proof-class, bridge etiquette. Write it like a fat
   skill (the loop lives here, determinism lives in the library).
3. `src/` — numbered entrypoints (00_Recon.cs style) + your library files.
4. `evidence/p*-*.json` — one artifact per proof minimum.
5. `pod.json` — schemaVersion 1, id = your workspace, entrypoints declared.

## Bridge etiquette (shared session — three pods run concurrently)

Expect contention: the bridge serializes and rejects busy. Space your runs, retry with
backoff, and keep each run short (one proof, not the whole battery). If Revit dies or
the bridge drops for >5 min, note it in NOTES.md and keep authoring code/docs — the
supervisor watches the session. Do NOT restart Revit, do NOT call live_restart, do NOT
open/close documents other than your own family docs.
