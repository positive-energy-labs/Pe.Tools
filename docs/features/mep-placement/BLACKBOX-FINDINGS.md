# Pea Blackbox Findings (live, 2026-07-03)

Driver: `peco talk-to-pea` (operator frame). Every pea claim independently verified by supervisor census/clash scripts + PNG reads — never trusted on self-report.

## Harness/product bugs surfaced (the campaign is earning its keep pre-comparison)

| # | Bug | Where | Status |
|---|---|---|---|
| B1 | Tool-approval gate armed headlessly → every tool-calling turn hangs forever | talk-to-pea-worker missing `yolo:true` | FIXED (agent) |
| B2 | Worker entry-gate dead under jiti → whole lane never ran | talk-to-pea-worker bottom guard | FIXED |
| B3 | Skills don't load in worker: `skill` tool sees "Available skills: ''" (empty), `skill_search` finds nothing — even the 6 bundled | worker Workspace skill wiring | SOURCE FIXED - worker resolves product home from host bootstrap and keeps skill roots under the contained workspace; needs black-box rerun |
| B4 | `script_execute` product tool sends `sourcePath: undefined`, RPC rejects, reports `isError:false` | pea product tool | FIXED - product tool omits nullish `sourcePath`; T2 control already proved the success path |
| B5 | `task_write` → `SQLITE_ERROR: no such column: threadId` in worker runtime | worker storage/memory profile | SOURCE FIXED - worker uses the production pea product-state storage profile instead of workspace-local `.pea/mastra.db`; needs black-box rerun |
| B6 | `host_operation_search` returns `[]` for a reasonable mutate query ("duct layout create ducts…", intent=Mutate) | capability map has no creation ops (expected) + search relevance | PARTIAL - unmatched mutate searches now fall back to scripting discovery; duct placement itself remains workspace-pod WIP |
| B7 | **Product-home divergence**: prod pea (`apps/pea/src/runtime.ts`) resolves product home from `homedir()/Documents/Pe.Tools` (stale copy), never via host. OneDrive redirects real Documents → host bootstrap returns `OneDrive/Documents/Pe.Tools`. **Deployed pea today loads only the 6 bundled skills and CANNOT see host-side skills** (the mep-* ones). Worker was fixed to resolve via host; prod is not. Fix: set `PE_TOOLS_PRODUCT_HOME` or make prod resolve through the host. | apps/pea runtime + skills.ts fallback | SOURCE FIXED - Pea product home now honors `PE_TOOLS_PRODUCT_HOME`, then Host-compatible `PE_TOOLS_DOCUMENTS_ROOT` / Windows Documents known-folder resolution |
| B8 | Skill fails to load if its `description:` frontmatter contains `: "` (colon-space, e.g. `Trigger phrases: "..."`) — gray-matter parses it as an invalid YAML mapping and drops the skill silently. Hit `mep-sketch-duct-layout`. | skill authoring / loader tolerance | FIXED (quoted the value); loader could warn instead of silently skipping |

## Baseline: UNSKILLED pea (control, skills failed to load — B3)

Task: supply trunk + 3 branches on L3, draft→commit, honest collisions. Skill load failed, pea improvised.

- **T1 (improvise):** Placed a complete, plausible rough-in (7 ducts, own comment tags, near-connect stubs, own PNG). **Reported "no collisions" — FALSE.** Supervisor clash check: trunk threaded 11× 20K6 joists + finish-floor slabs in the *linked* models. Pea's improvised check covered only the host model; it also chose 13 ft vs the level's 9–10 ft convention. ~11 tool calls.
- **T2 (correct, given my evidence + convention hint):** Recovered well — sampled existing L3 mains (z≈29.5), rebuilt lower, re-checked **link-aware**, used `read_image` on its export. Supervisor re-verify: **0 link bbox hits — genuinely clean.** Used `script_execute` successfully (7 calls) + `read_image`.

**Interpretation (the ladder thesis, empirically):** raw model judgment is NOT the bottleneck — pea can place, sample conventions, and self-correct. The bottleneck is the *operating loop*: without a skill it (a) never thought to check linked models, (b) didn't know the elevation convention, (c) invented an ad-hoc method each turn. Every round-1 toolkit surfaced link collisions and convention-matching **by construction**. This is the case for fat skills + the placement library carrying the loop, exactly as the philosophy doc argues.

**Corollary — `read_image` works end to end.** First live use: pea called it on an exported plan PNG without error and reasoned from it. Vision wiring is proven in the running gateway path, not just unit-tested.

## SKILLED pea — mep-solve, L3 (skill loads after B3 fix)

T1 (one turn, 900s budget): **pea followed the skill's loop faithfully** — ran the pod's `Scout` (recon) → `MapProbe` (ASCII occupancy) → `Solve` entrypoints, in order, in the first ~90s (host logs confirm WorkspaceKey=mep-solve, those exact source paths). Then read the draft PNG via `read_image`, edited intent, re-solved — and **hit the 900s wall still in the refine loop, before Commit.** Census: 0 committed (mid-refine when killed). vs the unskilled baseline which *finished* in one turn but was WRONG — the skilled run is correct-by-construction but ran long.

**This is the headline result: routing works, the single-turn budget doesn't.** The declare→solve→draft→diff→commit loop is a multi-checkpoint workflow; forcing it into one `talk_to_pea` turn starves the commit. Matt Pocock's "leg work per step" / turn-splitting applies directly.

Implications (feed task #9 — pea capability changes for hard tasks):
1. **Skills for hard tasks must checkpoint across turns** (or the harness must budget per-phase, or pea must commit a thin first draft FAST then refine on request — the "vertical slice" of placement). Perfecting-before-commit blows the budget and shows the user nothing.
2. **Recon output discipline:** `Scout` returned ~25 KB in one tool result — heavy context for one step. Compress recon; summarize-then-zoom.
3. **read_image is load-bearing and works** — lean into visual self-verification as a default operator habit.
4. Long autonomous turns need progress visibility; a killed turn silently loses in-flight work (draft rolled back) — the harness should surface partial progress / the skill should commit reviewable increments.

Retry in progress: continue the SAME thread with a tight commit-only turn (re-solve + commit, report ids + collisions) — tests whether a scoped follow-up turn lands the commit.

## Chadds reproduction campaign (2026-07-06, live heavy model)

Methodology (user-decided): REPRODUCE real duct networks, not improvise. BFS a terminal→equipment
network as ground truth (JSON), delete it locally (never sync), have pea rebuild it via the bundled
`place-mep-ducts` skill + `Pe.Revit.Placement`, grade fidelity + collisions independently.
Model: MEP_YoramLePairArchitects_ChaddsFord_R25 — 3,383 ducts, 374 terminals, 4 links (3 loaded).

**Port bug the heavy model surfaced immediately:** Chadds' Project Base Point sits at 348 ft, so
`Level.Elevation` (348) ≠ element geometry Z (≈0). DuctPlacer banded off `Elevation` → Scout saw
ZERO geometry on a level with 991 ducts, and pea thrashed on empty recon. Fixed with
`Level.ProjectElevation` at every functional site. Snowdon (PBP=0) could never catch this.

**Easy tier (net_6069858: 37.5 ft, terminal→fan with an 18.7 ft ceiling riser), thread c864ffbf:**
- T1: honest refusal with named blockers (pipes z 11.1–11.6 padded-blocking the terminal goal).
- T2 (commit-only follow-up, same thread): skipped recon as told, one adjusted re-solve at z=10,
  committed 7 elements, HARD 0 — terminal connection independently VERIFIED. Cross-turn
  checkpointing on a persisted thread WORKS.
- BUT: trunk ended plan-aligned exactly above the fan, 18.7 ft up — pea called the whole missing
  riser a "near-connect stub" (my prompt allowed stubs without a bound). 48% of GT length.
- T3 (riser fix turn): timed out at 600s mid-work; in-flight transaction rolled back; nothing landed.

**Grader-driven API refinements (all built, deployed pending restart):**
1. ENDPOINT GAP report — `{"element":id}` trunk endpoints are now tracked into the solve dto and
   Solve/Commit print the gap from the trunk end to the element's nearest free connector, with a
   pasteable fix. The easy-tier false-done was precisely this omission.
2. `Keep()` + PEA-TK-DONE — Solve()/Verbs-commit start with DeleteMarked, which silently wipes a
   committed-but-unkept increment. Incremental work = Commit → Keep → next Solve; kept elements
   become obstacles for later solves.
3. Scout: equipment lines print free duct connector (x,y,z) — routing to equipment needs the
   connector z, not the bbox; connected terminals collapse into Tgrp summary lines past 30.
4. Skill: stub bound ≤ 6 in, equipment-z clarify item, Keep-aware checkpoint-commit guidance,
   ENDPOINT GAP added to the report grammar.

Systemic (feeds task #9): commit turns need bigger budgets or in-skill increment commits (T3 was
actively working at 600s and lost everything); stub allowances without a numeric bound get
rationalized; talk_to_pea prompts with embedded double quotes crash the PS 5.1 arg path (exit 255).

**Medium tier v1/v2 → the turn-pace finding + the 3-script skill restructure:**
- v1 (900s): killed by an infra crash mid-run (Revit died; pea starved on a dead bridge). Not pea's fault.
- v2 (900s, new library live): ZERO geometry committed. Diagnosis: pea's loop pace is ~75 s/tool-call
  (fat skill + Scout + images in context), and the taught loop needed ~10+ calls; pea spent its 12
  calls on recon + writing an intent file + FOUR read_images and never reached Solve.
- Fix (skill restructure, v3): the loop is now THREE scripts — Scout; one WriteTransaction mega-script
  (inline intent → MapProbe → Solve → auto-Commit+Keep+ExportPlan when `HARD 0` and not refused,
  verbatim template in the skill); iterate-or-verify (one read_image AFTER commit only).
  Tool-call economy is now an explicit skill concept ("tool calls are your scarcest resource").
- Deferred library items (DLL locked while Revit runs): `ExportPlan(outDir=null)` → default to state
  dir; `SolveAndCommitIfClean(intent)` as a library method so the clean-check isn't string parsing.

**Ops notes for this lane:** `document.open` on Chadds holds the bridge ~44 min if the Manage Links
dialog is up (user always answers Ignore; op completed the moment it was clicked). A fresh Revit
process is the DLL-swap window — copy the new Placement DLL into the addin folder BEFORE the first
script references it.

**Medium tier v3+v4 — COMPLETE, the restructure works:**
- v3 (1500s, 3-script skill): 12 ducts + 8 fittings committed AND kept (PEA-TK-DONE), 129 ft,
  all 3 grilles physically connected with real risers, trunk at z=34.08 in-band. vs v2's ZERO.
- v4 (follow-up turn, same thread): pea routed the missing 7.7 ft fan riser + trunk tie with Verbs,
  fan connector VERIFIED connected; pea itself correctly disqualified the remaining
  `shape=Invalid` connector as a non-duct inlet. Final: 14 ducts + 10 fittings, 140.8 ft
  (121% of GT 116.8), z-band [25.9, 34.1] vs GT [24.9, 35.9]. All 4 endpoints connected.
- The proven workflow: turn 1 = 3-script loop with increment Keeps; supervisor measures gaps;
  turn 2 = targeted gap-fix. "Follow up on the persisted thread" is the product shape.
- **Fan-riser weakness confirmed systemic** (2/2 tiers missed it in turn 1): terminals are
  first-class in the intent (`branches.terminals` + `connect`) but equipment is a bare [x,y]
  trunk endpoint — nothing routes to the connector z. Library fix queued: `equipment` intent
  field symmetrical to terminals.
- B9: talk-to-pea parent crashed on worker results > one 64KB pipe chunk (unguarded JSON.parse
  per stdout data event, talk-to-pea.ts parseWorkerResponse). FIXED: try/catch → null → wait
  for the rest. v3's result was lost to it (salvaged threadId from the partial line; worker ok:true).
- Ops: a client-side script timeout does NOT abort the bridge op — PrepHard "timed out" at 120s
  but completed server-side (grade before re-running). PrepHard's delete cascade also swept the
  medium tier's kept ducts (mechanism unidentified — 11983650 gone after the collector delete);
  harmless here (never syncs) but worth understanding before shipping Cleanup-adjacent deletes.

**Hard tier turn 1 (1500s, thread af2a3060): the top landed, the chase didn't.**
- Roof cap 7873970 VERIFIED connected + a kept attic collector section at z≈35. 31 kept elements.
- All four fan discharge connectors still free; nothing below z=25.9. The multi-level chase (the
  actual hard part) exceeded the turn. Turn 2 (running) resumes from the verified state with
  per-increment priorities.
- **NEW library gotcha — stale-state Commit:** pea's fresh thread re-materialized the medium
  tier's geometry coordinate-for-coordinate under new ids (#11997099–163). The persistent state
  dir still held the medium solve DTO, and `Commit()` happily converted it — yesterday's solve,
  today's model. Accidental resume superpower, dangerous default. Fix queued: Commit must verify
  the DTO's draft ids exist in the model (or stamp solves per session) and refuse otherwise.

**Hard tier turn 2: the chase landed; the connector-ambiguity face of the equipment gap.**
- Chase committed + kept (3 ducts, 2 fittings, HARD 0, NEAR 1 @2.0in), top within the 6-in stub
  tolerance of the kept attic trunk, bottom open in the fan zone at z=−5.08. Honest per-increment
  report with resume state — exactly the choreography the skill teaches.
- Fan legs honestly refused: first preview 13 HARD, and **BranchTo auto-selected the WRONG HVAC
  connector on the fan family** (these fans have ~5 connectors: intake side already connected,
  discharge free, plus shape=Invalid non-duct stubs). Same root cause as the fan-riser miss:
  equipment connectors are not first-class. The `equipment: {element, connect}` intent field must
  pick by system type + free status + proximity, and Verbs needs ConnectTo(elementId, connectorHint).
- Turn 3 (running): manual point-based legs to verified discharge connector coordinates, Keep per fan.

**Hard tier design: net_6047210 — the whole-house exhaust collector.** 4 fans on 3 different
sub-levels (z −13..−6) → shared riser → ONE roof vent cap at z=36. 61 ducts / 58 fittings / 193 ft
across 4 levels. Deliberately beyond the single-level design envelope: forces multi-increment
Keep choreography + Verbs vertical legs. Prompt pre-prioritizes increments (riser+roof first,
then fans in order) and demands a resume-state report if the turn runs out.

## Pending

- Medium tier (net_6085577: Attic exhaust, 3 grilles→fan, 116 ft, sloped-roof z-band) — running.
- Hard tier on Theatre (densest: 1,119 ducts + 76 equipment) with the new library + skill live.
- Finish solve (commit + refine + cleanup + feedback-debrief), then sketch (L1-Block43) and route (L2) same protocol.
- Re-baseline B4/B5/B7 now that the user source-fixed them (worker runs source-linked via jiti → live next spawn).
