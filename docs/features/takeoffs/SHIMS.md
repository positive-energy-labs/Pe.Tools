# Takeoffs promotion — shims & compromises ledger

Every deliberate shortcut taken while promoting `/takeoffs` from prototype to functional
(2026-08-14/15). Each entry names the shim, where it lives, and what replaces it. An entry
leaves this file only when the replacement ships.

## Interfaces poorly adapted to the goal (fix candidates)

1. **The whole zone pipeline runs as longhand C# through `scripting.execute`.**
   `apps/web/src/takeoff/scripts.ts` + `host.ts`. The strings are now tiny calls into the typed,
   document-owned `TakeoffAtlas` and use the scripting runtime's structured `Result(...)`
   channel, but each should still become an installed `takeoffs.*` host op once shapes settle.

4. **Pre-sync Manual J entry is session-ephemeral.**
   `SessionOverlay.edits` (world.ts) — closing the tab loses entered data unless synced. The
   blob `meta` extension persists it only AT sync. A draft home (blob extension on every edit,
   or a .r10 working copy) is an open design question, deliberately unsolved.

5. **Insert payloads carry minimal polygon-derived exposures.**
   `buildRhvacInsert()` creates one floor, one roof, and a wall per Room Region polygon edge from
   the repo preset assemblies. Glass and doors remain empty; roof multiplier and wall direction
   are coarse. Replacing this with evidence-backed envelope classification is the follow-up.

6. **Assembly preset catalog is a shim** — `source/Pe.Revit.Takeoff/Rhvac/assembly-presets.json`
   (16 real assemblies mined from project-a via `mine-assembly-presets.ps1`, not dummies — but
   still one project's vocabulary). Per-project custom assemblies (the firm's actual practice)
   have no design yet. An unseen assembly silently becomes a zero row (reported in
   `assemblyFallbacks`, but a room with no wall load is a real hazard — callers MUST surface it).

7. **Room `Number` is allocated above the current file maximum at sync time** (SyncPanel).
   Engineer-facing room numbers are a firm convention the UI doesn't know; numbers are editable
   in RHVAC afterwards. The r10-link prevents re-insert, but update-by-identifier is not wired
   into the panel yet (inserts only — see 8).

8. **Sync is insert-only from the UI.** The updates lane (proven through live RHVAC) exists in
   the script/op layer but the panel builds `updates: []`. Drift reconciliation (re-sync a
   changed room by its stored Identifier) is unwired.

9. **`sensibleBtuh` on systems is always 0 in the live world** (world.ts `buildLiveWorld`).
   Loads are a .r10 fact; until a reconcile lane reads them back post-RHVAC-calc, the systems
   rail shows zeros and the 32k-cap warning never fires live. (Fixture shows synthetic loads.)

10. **Registry rename reconciliation is unreachable from the UI.** Adoption registers each
    zone's system tag in the Project Information registry, and sync resolves that tag against
    extracted `.r10` System names before first-run seeding. The rename-vs-new Revit registry
    operation still has no atlas interaction.

11. **`ceilingFt` for regions without a session run is 0** (world.ts `roomsOf` region branch) —
    mean ceiling height is a detection fact not persisted on the FR. Sync defaults 0 → 8 ft.

12. **Zone loops tessellate arcs to chords** (`FR_FRAGMENT` in scripts.ts). Straight-only is
    the detector's law anyway, but a hand-drawn curved zone boundary silently loses its arcs
    in the mask and the plan render.

13. **One-shot load, explicit refresh.** The route reads the model once per session target and
    after mutations; nothing watches for hand edits in Revit. Reruns are explicit by decision
    (DECISIONS.md), but a stale-world indicator (doc-changed event from the session list) would
    be honest — `useWorldLog` exists and is unwired.

14. ~~`/api/takeoff/export` dev route~~ — deleted; `rhvac.sync` replaced it and
    `takeoff/export.ts` was pruned with it (the op takes the camelCase extract shape directly).

## Backend shims (from the `rhvac.sync` build, all proven at the Jet layer)

15. **`fileIdentity` is weak by necessity** — the `.r10` schema has no GUID anywhere (Project =
    9 free-text columns). Stamp = sha256 over project+client titles; retitling in RHVAC breaks
    the link. All four parts (`fileName`, `projectTitle`, `clientName`, `stamp`) are returned so
    callers detect drift instead of trusting a match. The web side stores `fileName#stamp`.
16. **Sync op spawns 32-bit PowerShell by path convention** (`rhvacScriptDirectory`,
    rhvac-ops.ts:48-52) — dev-lane only; installed host reports 501. The installed-ops item on
    the scripted-E2E list owns this.
17. **Seed-room deletion is hardcoded to Identifier 1** — template convention, not schema fact;
    guarded by full equality against `DefaultRoom`, refusal reported in `seedRoom.reason`.
18. **Sync-order coupling**: the seed room must be deleted LAST — in the firm template it is
    the only row assembly code fields can clone from. Documented in export-rhvac.ps1; enforced
    only by statement order.
19. **The System name column is `Description`, not `Name`** — probe fact; extractor and sync expose
    it as `name`. First-run seeding inserts only `[Number]` + `[Description]`; no design payload is
    cloned.
21. **Insert-lane behavior change**: unknown assemblies used to throw; they now fall back to a
    zero row + report. Quieter by design — `assemblyFallbacks` is the contract.
22. **Nothing system-seeded has been opened in Elite RHVAC yet** — all proof is Jet-layer.
    The manual E2E's RHVAC open + Load Preview + save IS that proof; it cannot be scripted
    (no headless calc exists).
23. **PS 5.1 ANSI parse trap**: non-ASCII inside the 32-bit lane's scripts breaks parsing —
    all four Rhvac scripts are ASCII-only; keep them that way.

## Accepted (by decision, not oversight)

- FR is the proposal medium; diff-view proposals permanently out of scope.
- Blob-only decision authority; no sidecars; `/rhvac`'s localStorage lane deleted with the route.
- Legends ignored; adoption is explicit multi-select in the UI; re-adopt is the edit path.
- System seeding writes `[Number]` + `[Name]` only; all other System data entered in RHVAC.
- Template `.r10` is never pipeline-owned; sync always targets a copy.
- Manual E2E runs on the dev lane; installed `takeoffs.*` ops are a scripted-E2E gate.

## Closed during the first manual proof

- Partition results use scripting `Result(...)`, avoiding the 256 KiB stdout truncation that made
  the first project-a partition look like malformed JSON after its Revit mutation succeeded.
- Detector flags and `PE_M___RoomType` persist on Room Region FRs; reload is fail-closed.
- Reruns rebind/report only and create no unmatched proposals after a baseline exists.
- Sync compares `.r10` file identity, resolves existing System names, writes ventilation, validates
  every insert receipt, and links all Room Region provenance in one Revit transaction.
- Host logs now emit queued/started/completed lines with queue depth, wait, and duration.

## Remaining Open Takeoffs Route Items?

1. C# MaterializeAccepted(doc, view, zoneGuid, runId, acceptedRooms[]) — the accept verb's mechanism. It's the existing first-run create path, driven by an explicit accepted set instead of the firstRun branch, rebind-guarded so it never overwrites. This is what upgrades the unhomed-proposal block from "stuck" to "one-click accept." Proof: FreshRevit / live host.
2. takeoffs.sync atomic op with the three-phase Number-keyed link (#2). Lifts the whole SyncPanel.sync transaction out of the React route. Proof: Jet lane + live link round-trip.
3. Geometry + assembly to the library — move buildRhvacInsert's wall/octant math and the assembly constants out of the route; sync blocks on zero-assembly. Note: this is genuinely new design (presets are a self-declared shim, TakeoffGeometry.cs is the wrong layer). Proof: C# unit tests, then live.
4. Hygiene prunes — fixture scaffolding (buildZones/LEVEL_LANES/zoneGuid) to proto/; delete dead rhvac.takeoff + RhvacTakeoffData + old rhvac web stack + the decisionRows twin. Proof: compile + web tests.
