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

### Wave 2 (planned)

Graft wave 1; `/family` and `/families` onto the kernel; palettes proven against grafted ops; purge critic on the grafted tree; Documents migration run on the user's go.

### Wave 3 (planned)

Compile, deterministic, and attached-session proof of one capture, edit, apply loop per route; ledger sweep; this map deleted.
