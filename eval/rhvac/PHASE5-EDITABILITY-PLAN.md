# Phase-5 editability surface — implementation plan (2026-08-06)

Scope anchor: REFINEMENT.md phase 5 — "one-action human resolutions (split line, merge,
accept)… geometric where determinable, one-touch where not."

## 1. Inventory: what exists end-to-end, and the gaps

**Exists (live-proven per FLAGS-UI.md / E2E-PROOF.md):**

- **Flag emission.** Partition emits `open-plan-merge` / `low-evidence-boundary`
  (`MinBoundarySupport`, `LowBoundarySupportFlag`, Contracts.cs:104-107) and `seedless`
  (PartitionFormulation.cs:73). Flags ride TSVs as `META flag <id>:<f+f>` lines
  (Contracts.cs:172-173).
- **Web parse.** `parseTakeoffTsv` reads flag META lines leniently
  (apps/web/src/rhvac/takeoff.ts:24, `applyFlagMeta` ~:64-79); unknown kinds render and
  queue verbatim (types.ts:154-161).
- **Resolution model (TS).** apps/web/src/rhvac/resolutions.ts — verbs `accept` + `split`,
  `upsertResolution` (:31), pure idempotent `applyResolutions` (:50-89), deterministic chord
  bisection `splitShape` (:206-252, `.a`/`.b` children, `splitFrom` provenance),
  `pendingFlags` queue (:266), localStorage fallback (:284-310).
- **UI.** plan-pane.tsx — dashed flagged polygons (:483-522), `FlagQueue` one-touch buttons
  (:256-328), two-click split chord via `nearestOnRing` (:436-444). Route wiring
  routes/rhvac.tsx:157-202 (resolvedTakeoff memo, dual persistence, download/reset).
- **Sidecar + host op.** `rhvac.takeoff-resolutions` reads/atomically writes
  `<dir(.r10)>/takeoff-resolutions.json` (apps/host/src/rhvac-ops.ts:166-204); schema at
  packages/host-contracts/src/operation-types.ts:659 — `action: "accept" | "split"`.
- **C# mirror on export.** `RhvacCandidateBuilder.ParseTsvDirectory` auto-applies a sibling
  sidecar (RhvacCandidateBuilder.cs:170-171); `ApplyResolutions` (:175-204) mirrors TS
  semantics; consumed before `.r10` export.

**Gaps (each becomes a phase item):**

1. **Revit lane is resolution-blind.** `RoomTakeoff.MaterializeSpaces` (:134-142) applies
   zero resolutions — a split resolved in the web UI never changes materialized Spaces.
   (The in-flight flag-round-trip change fixes flag *visibility*, not resolution
   *application*.)
2. **Verb set incomplete.** Only accept/split. No merge, no reject, no residue claim.
   Schema literal (operation-types.ts:659) and C# validator (RhvacCandidateBuilder.cs:188)
   hard-fail on new actions.
3. **Residue doesn't exist yet** (in-flight: BRIEF-FLAGS-AND-JUNK part 2). Nothing parses,
   renders, or claims it.
4. **Renumbering trap unmitigated.** Ids are `R{rank}`, rank = area-descending
   (PartitionFormulation.cs:171, :229). Any detector change reshuffles every id; sidecar
   `candidateKey`s then mispoint and `applyResolutions` **silently skips** them
   (resolutions.ts:43-48) — idempotency lenience doubles as silent loss of human work.
5. **No loss accounting.** Neither TS nor C# apply reports applied/skipped counts.
6. **No measurement.** Nothing counts touches; score-takeoff.py scores raw TSVs only.
7. **Comments-stamp collision (design-around for in-flight change).**
   `SpaceMaterializer.Stamp` writes `token|roomId`; `Owned()` matches
   `startsWith(token + "|")` (SpaceMaterializer.cs:75, 254-258). Flag stamping must EXTEND
   this string (e.g. `token|R07|flags:open-plan-merge`), not replace it, or ownership
   cleanup breaks.

## 2. Minimal verb set and where each executes

One resolution = one recorded decision in the sidecar; **authoring happens in the web plan
pane; application happens in three mirrored consumers** (TS display, C# export, Revit
materialization — phase P4). Pea authors through the same host op, so agent proposals and
human clicks are the same artifact.

| Verb | Flag it answers | Params | Semantics | Web gesture | Revit-lane effect |
|---|---|---|---|---|---|
| `accept` | any (exists) | — | flag dropped, geometry stands | one button | flag not stamped |
| `split` | open-plan-merge (exists) | chord a,b (model ft) | deterministic bisection → `.a`/`.b` | two boundary clicks | two Spaces |
| `merge` | low-evidence-boundary, junk adjacency | `{other}` | union; survivor = larger id; `mergedFrom` provenance | flag row → click neighbor | one Space |
| `reject` | seedless, junk | — | room removed; polygon becomes explicit residue (conservation — never silent deletion) | one button | Space not materialized |
| `claim-residue` | META residue (pending) | `{residueId, into?}` | union residue into `into`, or promote standalone | click gray residue → neighbor or "promote" | residue joins target Space |

Verb discipline: `low-evidence-boundary` keeps only accept/merge (nudge-to-alternative
deferred, FLAGS-UI.md:68-69). No free-form polygon editing — every verb replays from ≤2
clicks of parameters.

## 3. Persistence and replay — sidecar v2, defusing renumbering

1. **Anchors.** Each resolution gains `anchor: {label: [x,y], sqft}` captured at record time
   (room label point + area). Chord/merge params are already model-frame, so geometry
   replays regardless of ids; the anchor makes the room *reference* geometric too.
2. **Re-key pass on load.** If `candidateKey` resolves and the room contains the anchor
   (sqft ±20%), apply; else find the room containing the anchor and **remap**; else the
   resolution is **orphaned** — retained, surfaced in UI, never silently dropped. Mirror in
   TS + C#, shared fixture test asserting identical remap outcomes.
3. **Loss accounting.** Apply returns `{applied, remapped, orphaned}`; FlagQueue footer
   shows "N orphaned decisions — review"; export path logs the triple and warns/refuses on
   orphans > 0.
4. **Provenance stamp.** Sidecar v2 records per-level TSV sha256 at write time; on hash
   mismatch the UI badges "recorded against an older detection". v1 files stay readable
   (key-match only, orphan on miss).
5. **Residue** entries must carry polygons + label point; claim-residue anchors on the
   residue polygon's label point, not its ordinal.

Why not stable detector-emitted ids? Changing `R{rank}` ripples through room-map.json,
score-takeoff.py, curated notes, and fixture TSVs mid-campaign; anchors solve it at the
consumer edge without touching the output contract.

## 4. "Done" — the measurable gate

**Primary metric: touches-to-clean on project-a Upper** (45 GT rooms; today ratio 1.76,
42 junk, 46.8% matched). Touches = recorded resolutions. Clean =

- 0 pending flags, 0 unclaimed residue;
- candidate/GT ratio ≤ 1.2 on the level (existing GATES threshold);
- post-resolution level TOTAL ≥ unresolved baseline (resolutions never cost accuracy);
- taxonomy `missing` not increased.

Tooling: `score-takeoff.py --resolutions <sidecar>` (python mirror of apply semantics) so
the scoreboard scores the *resolved* takeoff and prints a RESOLUTIONS block: touches by
verb, applied/remapped/orphaned, before/after ratio + score.

**Phase-close targets:** project-a Upper cleans in ≤25 touches with score non-regression;
replay determinism (same sidecar twice, TS vs C# parse → identical room sets); renumber
survival (one knob tweak reshuffles ranks → ≥95% auto-remap, 0 silent drops); lane parity
(materialized Space count = resolved room count, splits = two Spaces; one live session).

## 5. Phase ordering (exit gates; codex vs taste)

- **P0 — dependencies (in flight, coordinate only):** flag round-trip + residue emission.
  Hand-off notes: Comments token collision (§1.7); residue needs polygons + label points.
  *Exit: both merged; residue visible in a project-a TSV.*
- **P1 — accounting + anchors (sidecar v2).** Anchors, re-key, orphan reporting in TS + C#,
  `--resolutions` scoring, v1 compat. No new verbs yet — hardening first. *Exit: renumber-
  survival gate passes offline; mirror tests green.* **Codex slog.**
- **P2 — verbs `reject` + `merge`.** Schema, C# validator, apply mirrors, conservation
  (reject → residue), UI gestures. *Exit: mirror tests cover 4 verbs; scripted project-a Main
  sidecar with merges/rejects exports with expected room count.* Schema/apply/tests =
  **codex**; gestures = **taste** (short).
- **P3 — residue surface.** Parse META residue (TS + C#), gray unclaimed render,
  claim/promote gestures. *Exit: project-a shows residue; claiming changes export area; zero
  unclaimed reachable.* Parsing = **codex**; interaction = **taste**.
- **P4 — Revit lane parity.** Apply sidecar in MaterializeSpaces before
  `SpaceMaterializer.Replace` (small shared core or faithful port of the builder's apply,
  mirror-tested; builder operates on its own LevelTakeoff type). Resolved Spaces stamp
  provenance. *Exit: live lane-parity gate on project-a Upper.* **Codex** + user-owned live
  re-verify.
- **P5 — touches-to-clean campaign close.** Touch counter, real cleaning session on projectA
  Upper (human or pea), record the number, attach overlays, close phase 5 under the
  GATES-naming rule. **Taste.**
- **P6 — deferred explicitly:** Revit-authored resolutions (harvest human Space edits back
  into the sidecar), low-evidence nudge-to-alternative, nested splits, split preview line.

Rationale: P1 before P2/P3 — the sidecar schema breaks once, before three new verbs write
v2 records; P4 after P2 so the Revit port lands the full verb set in one pass; P5 last —
touches-to-clean is only honest once residue and all verbs exist.
