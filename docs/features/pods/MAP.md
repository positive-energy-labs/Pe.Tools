# Crusade map: pods and product route normalization

Live-effort frontier for the `crusade/normalize` branch. Swept when the crusade ends; verdicts promote to `LEDGER.md`.

## Form

```
MISSION   Every product route (/family, /families, /schedules) and /pods runs on one route kernel over one pod boundary and one op grammar, with the same features as today. Never remove a feature; never add a shim, flag, or migration path in product code.
NUMBER    dead names in the tree: git grep -cE 'familyfoundry\.|schedule-grid\.|scripting\.pod\.|moduleKey|rootKey|releaseHash|externalRequirements|\.family\.json|composed/|settings\.document\.' -- source ':!*generated*' ; target 0. Secondary: LOC of apps/web/src/{family,families,schedule-grid,settings,prototype-pods,route}, apps/host/src/settings.ts, Pe.Revit.Scripting/Pods, Pe.Shared.Scripting/Pods, Pe.App/Pods (baseline 25,116); route definitions on the kernel: 3 of 3.
EYE       the commander reads every builder report and diff; browser preview of /pods and /schedules per wave; the eye outranks the number.
GATES     dotnet build of touched C# projects; vp check and vp test in source/pe-tools; no hand-edited generated files; no `SHIM:` left un-owed at graft.
WIDTH     5 builders per wave, 90 minutes each, Opus high, one worktree and one branch each.
DRY       a wave that grafts nothing and narrows no Owed line is dry; two dry waves end the crusade. Polish is a stop.
ABSENT    the commander may rule on names, seam ownership, and which builder's shape wins a collision; each ruling is re-openable and listed below.
LEDGER    docs/features/pods/LEDGER.md (verdicts), this map (waves), .artifacts/handoffs/crusade-normalize/ (dogma, posture, briefs, reports).
```

## Absent rulings (re-openable)

- 2026-09-16: Main merged into `crusade/normalize` at `93cf9c3` before wave 1 (103 commits, one overlapping file). The crusade builds on the pane and Surface contract main landed today. The sibling `unify/routes` branch is not merged; its 21-file delta is the user's to land later.
- 2026-09-16: Ledger line "the host is the only reader of the pod folder" is narrowed. The host owns member editing I/O (list, read, write, `imported.json`) so the web works offline. The C# pod library is the only composer; palettes call it in-proc, the host calls it through `pod.member.compose`. Engines write receipts because both palettes and host reach them.
- 2026-09-16: Wave 1 builders code to the op contract in `dogma.md` before the C# side exists. The TS seams may declare the new op types in one `SHIM:` file the commander deletes at graft when the generated contract lands.
- 2026-09-16: `pod.member.write` stays create-only for capture. Editing a saved member in place is a feature the old `/settings` had, so the contract gains `pod.member.save` (pod, path, content, expectedSha256) that overwrites only when the sha matches and returns the new sha. Wave 2 adds it in pod-core, host, and the spec editor; "save as new" stays as a second affordance.
- 2026-09-16: Two builders implemented `pod.list`, `pod.member.read`, `pod.member.write`: pod-core as bridge ops, host as host-local ops. Ruling per the earlier narrowing: the host-local ops are canonical (they work offline); the three C# bridge ops are deleted and the C# library keeps the functions for palettes in-proc. The bridge keeps `pod.member.compose`, `pod.export`, `pod.import`.
- 2026-09-16: `pod.member.write` and `pod.member.save` stay two ops (host had one op with an optional `expectedSha256`). Two states in one op is the guard the type can remove.
- 2026-09-16: Capture on `/family` must keep showing coverage and unmodeled facts after it files the member (law 12). The capture workflow returns the member address plus the capture evidence, and the route shows the evidence beside the new member.
- 2026-09-16: `pea script import` keeps its local folder choice (`--folder`), per law 12; the earlier "stay out unless a workflow needs them" ruling is withdrawn for import.
- 2026-09-17: Pod reads stay in `host/` with no Reading. The host serves no pod resource owner and no route needs live pod invalidation; the unserved `member` Reading kind in `agent-contracts/src/reading.ts:79` is Owed for deletion at sweep.
- 2026-09-17: `FamilyProfileConverter.cs` stays until the user rules. The relay asked; no answer arrived before wave 4 was cast. Purge keeps features, and the 50 legacy profile members depend on it.

## Waves

### Wave 1 (cast 2026-09-16)

| Builder | Seam | Branch | Owns |
|---|---|---|---|
| w1-pod-core | C# pod library and `pod.*` ops | crusade/w1-pod-core | `Pe.Shared.Scripting/Pods`, `Pe.Revit.Scripting/Pods`, `Pe.App/Pods`, scripting bridge handler, archive vendoring, receipts writer |
| w1-engines | C# bridge ops, engine edges, palettes | crusade/w1-engines | `Pe.App/Host`, `Pe.App/Commands/{FamilyFoundry,Schedules}`, `Pe.Shared.HostContracts/Operations`, schedule apply and capture edge |
| w1-host | TS host | crusade/w1-host | `apps/host/src/{settings,family-actions,schedule-actions,call-route,local-ops}.ts` and neighbors |
| w1-web | TS web kernel, `/pods`, `/schedules` | crusade/w1-web | `apps/web/src/{route,settings,settings-panes,prototype-pods,schedule-grid}`, `routes/{settings,prototype-pods,schedule-grid}.tsx` |
| w1-migrate | Documents migration script, Pea MCP names, skills | crusade/w1-migrate | `.artifacts/tmp/migrate-documents.ps1` (dry-run default), `packages/mcps/src/pea`, `.agents/skills` text naming routes and ops |

Verdicts per builder land here after harvest: ADOPT / KILL / FALSIFIED with stake.

- w1-engines: ADOPT pending graft. Stake `crusade/w1-engines` at `aab3d11`, report `reports/w1-engines.md`. Six family ops and two schedule ops with one `ApplyWithReceipt` edge that refuses a stale member sha; palettes on pod members; compile lane green for `Pe.App`, tests, contracts; Revit UNPROVEN. Two authorized SHIM files (`PodRuns.cs`, `ScriptPodMemberCompose.cs`) reconcile against w1-pod-core at graft. Left for wave 2: delete the duplicate `revit.apply.schedule` profile lane (`RevitDataRequestService.cs:477`) and rule on `revit.apply.family-model`; `agent-contracts/src/family-actions.ts` executors; `scripts/familyfoundry-monthly-host-proof.mjs`.
- w1-migrate: ADOPT pending graft. Stake `crusade/w1-migrate` at `38ce64b`, report `reports/w1-migrate.md`, plan `reports/migration-plan.md` (21 pods, 592 actions, 26 findings, 2 pre-existing broken `@global` refs). Script is dry-run by default, proven on a scratch copy; `-Apply` moves the old tree to `_migrated-<date>`. Pea and agent-contracts use `pod.*` and `{ pod, path }`; mcps 57 pass, 2 fail on a host fixture still naming `schedule-grid` (w1-host owns). Absent ruling: crossing into `packages/agent-contracts` was right because it types the route names; graft resolves textual conflicts with w1-host. Left for the user: `settings/Global/settings.json` holds APS client secrets that the script never copies; move them to runtime `credentials.json` before `-Apply`. Left for wave 2: `pod.import` folder choice and `pod.export` path stay out unless a workflow needs them; saving an existing member on `/pods` needs a writer beside `pod.member.write`.
- w1-pod-core: ADOPT, grafted at `0d358ea`. Stake `crusade/w1-pod-core` at `05c0e41`, report `reports/w1-pod-core.md`; net -1,387 lines. Reduced manifest, per-member `Compose`, id resolution naming both folders on a duplicate, vendoring export with nested-reference rewrite, `imported.json`, `PodRuns.WriteReceipt`, six `pod.*` ops on the scripting bridge handler; deterministic lane green for `Pe.Shared.Tests` including the new `PodTests.cs`. Absent rulings: `PodReceipt` lives in `Pe.Shared.HostContracts.Scripting` because `scripting.execute` returns it on the wire; a vendored fragment with its own references is rewritten, so only leaf fragments are byte-identical (ledger wording to narrow at sweep). Left: Pe.App palettes compile against the deleted catalog (w1-engines graft), `pod.import` does not refuse an already installed id (ruled: keep; resolution names both folders).
- w1-migrate grafted at `078e718`.
- w1-web: ADOPT pending graft. Stake `crusade/w1-web` at `4623545`, report `reports/w1-web.md`; net -459 lines with `/prototype-pods`, `/settings`, `/schedule-grid` deleted. `EntityRouteDef` and `entityRoute` in `route/manifest.ts:162,208`; spec editor with one draft and two modes; `/schedules` and `/pods` on the kernel; 424 web tests pass; `/pods?demo=browse` and `/schedules?demo=apply` render in the browser lane with no console errors. Host and Revit UNPROVEN. Left for wave 2: switch `callHostDynamic` to typed calls after graft; grid keys and Work route name `schedule-grid` follow agent-contracts (now renamed by w1-migrate); `/family` links to the deleted `/settings`; families confirmation sheet; page state not in the URL so `/pods` cannot deep-link a spec; `SchemaToFieldRender` still keyed by `moduleKey` for remote field options.
- w1-engines grafted at merge of `1c27dae`: shims deleted, `PodMembers.cs` is a thin view over the library, contract regenerated from a compiling Pe.App (72 ops), `codegen:check` in sync, `Pe.Shared.Tests` deterministic green. Run outputs are flat files named `<family>--<file>` because `WriteReceipt` takes plain names.
- w1-web grafted.
- w1-host: ADOPT pending graft. Stake `crusade/w1-host` at `14dd9b2`, report `reports/w1-host.md`; `settings.ts` 1000 to about 400 lines, net -1,370. Members `{ pod, path }` with host-native file I/O, offline ajv, `CompositionNeedsRevit` info instead of error, capture ending in a member write, apply as plan-then-apply on one key, `pod-members.test.ts` 73 targeted host tests green; full host suite fails only where it boots the old web. Overran the 90-minute box on scenario test runtime.
- w1-host grafted at `e8d577f` (report Graft section): three duplicate C# bridge ops deleted (69 ops), write/save split, both shims gone, web and Pea typed; `/family` and `/families` re-addressed to members; web 426 tests, host non-scenario 148 tests green; six demo pages render headless with no page errors. Left that becomes wave 2: `/family` lost its capture evidence panel (coverage, unmodeled facts) because capture now files a member instead of a reading; three scenario failures in takeoffs and chat suites unconfirmed on the base; `settings.schema`, semantic validation, and field options still module-keyed in C#.
- Wave 1 closed. NUMBER on the grafted tree: 147 dead-name hits in 57 files (baseline 492 at `8143b9a`). Secondary LOC 20,222 (baseline 25,116). Kernel routes 2 of 3 (`/schedules` on it; `/pods` beside it).

### Wave 2 (cast 2026-09-16)

| Builder | Seam | Line | Branch |
|---|---|---|---|
| w2-family | `/family` onto the kernel, evidence panel restored | cn-host (primed on the member re-address) | crusade/w2-family |
| w2-families | `/families` onto the kernel, plan confirmation sheet, URL page state | cn-web (kernel author) | crusade/w2-families |
| w2-engines-cleanup | duplicate lanes, `family.build`, schema-url keyed ops, NUMBER to 0 | cn-engines | crusade/w2-engines-cleanup |
| w2-critic | read-only purge critic on the wave 1 graft | fresh agent | none (reads `crusade/normalize`) |
- w2-critic: ADOPT as a reading. Report `reports/w2-critic.md` on `f627e68`. No `SHIM:` markers survive; ten purge rows ranked; three homeless features named (Pea proposal lane has no home outside `/family`; remote field options in the spec editor ask for an empty module; `pea script import` lost its folder choice). Dogma grade: law 11 and law 10 bent because the dogma promised ops nobody owned; the "ops under `Pe.App/Host`" paragraph was wrong; law 9 and 14 collide in the one-key plan/apply on `family.apply`.
- w2-family: ADOPT pending graft. Stake `crusade/w2-family` at `cfc04e4`, report `reports/w2-family.md`; net -5,627 lines with both family prototypes, `src/family-review`, and the settings file workspace deleted. `/family` is one `EntityRouteDef` (`route/family/manifest.ts`); capture returns `{ member, evidence }` and the evidence panel is back; `SchemaToFieldRender` keyed by `schemaUrl`; web 395 tests, host capture test green; three demo pages render headless. Kernel needs for w2-families: per-stage `needs` (family document for capture and apply), spec picker in every stage, `spec-editor.tsx:231` must pass `schemaUrl`, `families/matrix.tsx:103` deep link. Absent ruling: `/family` keeps a real plan through the confirm admission; law 9 wording ("only families") narrows to "families is the only bulk plan".
- w2-engines-cleanup: ADOPT pending graft. Stake `crusade/w2-engines-cleanup` at `8f4dbd9`, report `reports/w2-engines-cleanup.md`; net -276 lines. Duplicate schedule profile lane gone, `family.build` with receipt, settings ops keyed by `schemaUrl` with one C# resolver, `settings.validate`, `availableModules` and `settings.module-catalog` deleted, PostHog reads preferences, stray `-w` deleted; contract 68 ops in sync; NUMBER 147 to 42. Left: 40 of the 42 are `.family.json`, the family engine's sibling-file convention for nested models (`FamilyModelBuild.cs:69`), which no brief may touch; `families/store.ts:98` still looks for `familyfoundry.apply` receipts (live defect, sent to w2-families); `revit.apply.schedule` is now table-only and misnamed.
- Absent ruling: law 3 narrows to "a suffix never selects a validator". The engine's `<name>.family.json` sibling convention for nested models is a reference convention inside the engine, listed Owed for the engine owner, not a crusade target.
- w2-families: ADOPT pending graft. Stake `crusade/w2-families` at `91bc18d`, report `reports/w2-families.md`. Kernel plan lane (`ApplyPlan`, `admissionPlan`, one `PlanSheetView`), selection target, URL page state with `/pods` deep links, `/families` as one definition with the old scope and review stages folded; kernel needs from w2-family delivered (per-verb needs from the contract, `specPicker`, `onCaptured`, shared `ffPlanRow`); web 433 tests green, `/families?demo=apply` and `?demo=capture` and the `/pods` deep links render in the browser lane. Graft order: after w2-family lands, the families line merges and applies `plan: admissionPlan("family.apply", ffPlanRow)` on `/family`, fixes `families/store.ts:98`, and sets `schemaUrl` on the spec editor.
- w2-families grafted at merge of `80fcbd6`: `/family` on the kernel plan lane and spec picker, `families.apply` receipt key fixed, spec editor keyed by the member's schema URL as `pod.list` reports it; web 403 tests green; `/family?demo=apply`, `/families?demo=apply`, and `/pods` deep links render in the browser lane with no console errors.
- Wave 2 closed. NUMBER: 39 hits in 19 files (492 at baseline, 147 after wave 1); every remaining hit is the family engine's `<name>.family.json` sibling convention or a test asserting a removed field is unknown. Secondary LOC 20,156 (baseline 25,116). Kernel routes 3 of 3 plus `/pods`. Revit lane still UNPROVEN on every route.

### Wave 3 (cast 2026-09-17)

| Builder | Seam | Line | Branch |
|---|---|---|---|
| w3-host | families capture evidence, one spec address, confirm/apply split, `route/pods.ts` reads behind a Reading | cn-host | crusade/w3-host |
| w3-editor | Pea proposal lane in the spec editor; `apps/web/src/settings` folded away | cn-web | crusade/w3-editor |
| w3-engines | purge rows 7 to 9, data-table op name, `/pods` deep link from Revit, dead descriptor fields | cn-engines | crusade/w3-engines |
| w3-demo | live demo lane so capture and apply get a browser proof; scenario suites | fresh agent on cn-pod-core | crusade/w3-demo |

- w3-editor: ADOPT, graft held until wave 3 closes so the user's review server stays still. Stake `crusade/w3-editor` at `ed9edd0`, report `reports/w3-editor.md`. The Pea proposal lane lives in the spec editor (`useMemberWork`, `memberWorkManifest`, `ProposalLane`); `settings-panes` gone and `settings/` holds one primitive; `/pods` shows proposals on any member; web 405 tests; browser lane shows the lane on `/pods`, `/family?demo=build`, `/family?demo=apply`. Left: two save paths on one member (draft bytes via `pod.member.save`, staged fields via `settings.write`) that refuse each other until adopt; the reviewer component imported from `workbench` into a kernel file. Both are wave 4 or ledger Owed.
- w3-engines: ADOPT, graft held with the others. Stake `crusade/w3-engines` at `a77afa4`, report `reports/w3-engines.md`. Pod source fallback deleted and bounds emitted once through the catalog as `scriptPodSourceBounds`; specs pass through as authored with one `$schema`-keyed conversion at the family edge; one `PodMember` and a `PreparedPod | RefusedPod` union; `data-table.apply`; `/pods` deep link from both Family Foundry palettes; dead descriptor fields gone; 68 ops in sync; all packages green except the pre-existing chat scenarios and `demo-lane.scenario` which imports a file w2-family deleted (w3-demo owns that suite). Net +12 hand-written lines: the union and the shared constants cost more than the deletions saved, and the report says so.
- w3-host: ADOPT, graft held. Stake `crusade/w3-host` at `e126dda`, report `reports/w3-host.md`. `family.confirm`/`family.apply` and `families.confirm`/`families.apply` are separate workflows with `planHash` required on apply; the stored families plan reading and `Work.spec` are deleted so the page member is the one spec address; `families.capture` returns evidence and `/families` shows it; pod reads moved under `host/` and the ratchet baseline lowered to 10; 20 rewritten families tests, kernel and agent-contracts green; both sheets render headless. Absent rulings: both applies take `expectedPlanHashes` (a one-entry record for `/family`) so the kernel's `each` flag can go, owed to wave 4; the pod reads are not behind a Reading because the host serves none, and inventing a resource owner is a wave 4 decision, not a ratchet trick. Left: `demo-lane.scenario` 11 of 17 fail on the old verb selectors (w3-demo owns the rewrite; graft resolves that file toward w3-demo); plan sheet header overlap goes to the protoui round.
- w3-demo: ADOPT pending graft. Stake `crusade/w3-demo` at `4f646d1`, report `reports/w3-demo.md`. `?demo=<seed>&live=1` runs a route's real code against the host's simulated owner; three live loops (schedules capture-apply, family capture-confirm-apply, families capture-confirm-apply) each end with a run receipt shown on `/pods`; `demo-lane.scenario` 22 of 22 including the loops; host non-scenario 150 green; `chat-flow` and `chat-stale-hydration` confirmed failing on the base before this work, so they are not crusade regressions.
- w3-engines, w3-editor, w3-host grafted at `0e93832`. w3-demo conflicts with w3-host in `demo-lane.scenario.test.ts` and `families/store.ts`, and semantically with the confirm/apply split; its author grafts.
- Absent ruling: `/families` applies both `FamilyFoundry/patches` and `FamilyFoundry/models` members, because capture files models and the family edge converts by `$schema`. `EntityRouteDef.schema` takes a list. Without this, capture on `/families` cannot feed apply on `/families`.
- w3-demo grafted at merge of `123f356`: live loops assert the admitted workflow sequence (`*.capture`, `*.confirm`, `*.apply`), `/families` applies the member it captured, `EntityRouteDef.schema` takes a list, dev proxy forwards `/schedules/readings`; scenario 22 of 22, host 151, web 407, repo guards 93 of 93.
- Wave 3 closed. NUMBER 39 (unchanged; all engine-internal `.family.json` or a test of a removed field). Secondary LOC 20,359. Whole crusade against main: 283 files, +10,384 / -16,808. Revit lane UNPROVEN on every route; that is wave 4 with a controlled `pe-revit` session.

### Wave 4 (cast 2026-09-17)

| Builder | Seam | Line | Branch |
|---|---|---|---|
| w4-apply | `expectedPlanHashes` on both applies, `each` flag deleted, plan sheet header, demo owner leftovers | fresh (cn-host retired) | crusade/w4-apply |
| w4-save | one save path per member in the spec editor; reviewer out of `workbench` | fresh | crusade/w4-save |
| w4-red | census then fix of the four standing failures; session ladder on `/schedules` | fresh | crusade/w4-red |
| w4-revit | session lane: one capture, edit, apply loop per route and both palettes; edits no product code | fresh | crusade/w4-revit |

Not cast: the protoui round (table beside draft, `/families` row click into `/family`) waits for the user's route feedback.

- w4-apply: ADOPT, grafted at `120b1c5`. Report `reports/w4-apply.md`. `family.apply` takes a one-entry `expectedPlanHashes`; `PlanSheet.each` deleted; plan sheet header cells separate; demo capture stamps the host `$schema`; demo owner serves host-status. Behaviour change: `parameter-links.apply` no longer refuses an unsaved project. Left: the native C# `family.apply` still takes `planHash` and the host translates in one line.
- w4-save: first flight FALSIFIED the brief's mechanism. Tried and rejected: folding draft edits into staged field patches (a key beside a `$preset` has no patch form; formatting edits yield zero patches). Absent ruling: the raw draft is the base and staged pointers apply on top; the one guard is a staged pointer whose container the draft removed. Second flight ADOPT, grafted at `828dfe4`; browser lane against an isolated real host, one save, no refusal. Left: the host keeps an applied proposal after `settings.write` (`apps/host/src/family-actions.ts:490`); array fragments are not editable (`route/spec-editor.tsx:261`); `route/use-route.ts:51` imports `workbench/config`.
- w4-red: ADOPT, three flights, grafted at `3b1e533`, `d6f5156`, and the third-flight merge. The ladder reads the kernel inventory (`route/situation.tsx:238`), which is also w4-revit defect 1. Absent ruling: the dev-only devtools trigger moves to `middle-left` (`routes/__root.tsx:78`); `chat-flow` 3 of 3, `chat-stale-hydration` 11 of 12 with one unexplained failure. Confirm was offered while the pod list re-read; confirm `ready` now needs the saved member (`route/manifest.ts:443`); `demo-lane.scenario` 22 of 22 ten runs in a row. Not reproduced: the `live.test.tsx` temp-dir race.
- w4-revit: ADOPT as a reading. Report `reports/w4-revit.md`, session lane, controlled session `w4-revit`, commit `ad76e9b`, payload `dev`. PROVEN: `/schedules` capture and apply with Revit read-back; `/family` capture, edit, confirm, apply with read-back (after clearing `unmodeled` by hand); `/families` capture and scoped confirm; `/pods` run receipts. FALSIFIED: confirm on a freshly captured family member (defect 3); `/families` confirm on a large model (defects 4, 5, 7, 8, 17); `/families` apply from the browser; the Schedules palette deep link (none exists). UNPROVEN: both palettes in-proc (no lane drives Revit WPF). Commander error: the builder's uncommitted evidence under `.artifacts/w4-revit/` (screenshots, pod snapshot, confirm JSON) was deleted when the commander retired the worktree; the claims now rest on the report text alone, and the wave 5 rerun must commit its evidence.
- Wave 4 closed. NUMBER 39 (unchanged, all engine-internal). Whole crusade against main: 313 files, +14,188 / -16,845. Repo guards 93 of 93 on the grafted tree `HEAD`. Not re-run on the final graft: full host and web suites (last green on w4-red's third-flight tree, which carried every code graft). Wave 4 was not dry: four grafts, and the Revit lane moved from UNPROVEN to a 19-row defect census.

- 2026-09-17, user verdict: "commit everything first and then migrate aggressively. outputs can be deleted." The Documents migration ran with `-Apply`. The Documents repo holds snapshot `3a39717` before and `cfb9f38` after. Result: 21 pods and 546 files under `Pods/`; `preferences.json`; APS credentials written to the runtime `state/aps-auth/credentials.json`; every `output/`, `bin/`, `obj/`, the generated schemas, and `settings/Global/settings.json` deleted; `_archive-2026-09-17/` holds `inline-scripts`, four `takeoff*` folders, `tmp`, `temp_audit_run`, and one intent file, indexed by its `README.md`. Lane: artifact (every `pod.json` parses with an id; sampled `@local` references resolve). UNPROVEN: the host and Revit reading the migrated tree; the user proves that in the palette tests. The 26 findings stand in `reports/migration-plan.md`.

- 2026-09-17, user verdict: "a sibling member in the run output folder makes sense." Capture writes the engine's `unmodeled` list as a file in the capture's run folder under `output/<runId>/`, beside the receipt. The captured member holds only what the engine can apply. This settles wave 5 candidate 1.

### Wave 5 candidates (none cast; from `reports/w4-revit.md` defect numbers)

1. Capture then confirm on real families: captured `unmodeled` entries make the member fail its own composition (defect 3). Needs a ruling: capture files `unmodeled` as evidence outside the member, or the validator treats it as advisory.
2. `families.plan` takes the route scope natively, and a category-only scope resolves to family names before the post-filter (defects 4, 5).
3. The action client: a 30 s signal abandons a long confirm, then the retained admission refuses the next plan with no recover affordance (defect 7).
4. `/families` read pressure on the Revit queue: the `loaded-families` catalog loop and the 1 to 2 minute matrix read (defects 8, 17).
5. Host capture `$schema` origin uses the default base URL, not the running host (defect 2, `family-actions.ts:83`).
6. Engines: swallow the Revit warning modal during plan; refuse a workshared model without central before editing; write `reason` on a failed receipt; `pod.list` excludes `output/`; Schedules palette gains the `/pods` deep link; native `family.apply` takes `expectedPlanHashes` (defects 6, 11, 18, claim 15).
7. Kernel log prints the verb label, not the action key (defect 9); spec editor field options pass the target (defect 10).
8. Rerun the Revit lane on a non-workshared clone after 1 to 4 land, evidence committed. Palettes need a human click or a UI lane.
9. Protoui round, waiting on the user's route feedback; now also holds the narrow-pane plan sheet scroll.
10. Owed elsewhere: dev watcher spurious restarts (defect 16), `pe-revit doc close` on a detached document (defect 19, SDK owner), Pe.App external-tool failure dialog at startup (defect 13), in-app browser cannot load the dev origin (defect 14).

Wave 3 items from the critic, for reference:

- `families.capture` returns `{ members, evidence }` like `family.capture`, and `families.plan` takes `{ source }` so `/families` has one spec address instead of page plus Work. Owner: the host line.
- `route/pods.ts` host reads move behind a Reading so the `hostBelowRoute` ratchet holds at its baseline of 11; raising the baseline is not the fix.
- A demo lane that drives the host's simulated owner from the web (`host/demo-client.ts` has no importers), so capture writing and apply completing get a browser proof. Until then those two claims stay deterministic-only.
- Row click on `/families` no longer carries into `/family`; the open-then-capture flow is a protoui question, owed with the table-beside-draft round.

- `family.apply` splits into `family.confirm` (plan only) and `family.apply` (planHash required), the same ruling as write/save. Owner: the `/family` line after w2-family lands.
- The second member editor (`apps/web/src/settings/*`, about 700 lines) folds into the spec editor, which gains the Pea proposal and staging lane so `/pods` shows proposals. Owner: a fresh web builder.
- Remote field options keyed by `$schema` URL end to end (critic purge row 4 finishes what w2-engines-cleanup starts).
- `PeToolsBrowser.cs` deep link targets `/pods?pod=&path=` once page state is in the URL.
- Purge rows 7 to 9: C# fallback pod capture and duplicated bounds, the `{ patch }` wrap in two languages, the duplicate `PodMember` record in `Pe.App/Pods`.
- OPEN for the user: `FamilyProfileConverter.cs` converts legacy FF profiles inside the product engine (law 13). It is also the only way the 50 legacy profile members in the migration plan become usable. Rule: keep as the one-shot converter invoked by migration, or delete with the members.

### Wave 2 (planned)

Graft wave 1; `/family` and `/families` onto the kernel; palettes proven against grafted ops; purge critic on the grafted tree; Documents migration run on the user's go.

### Wave 3 (planned)

Compile, deterministic, and attached-session proof of one capture, edit, apply loop per route; ledger sweep; this map deleted.
