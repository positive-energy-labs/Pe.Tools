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

### Wave 2 (planned)

Graft wave 1; `/family` and `/families` onto the kernel; palettes proven against grafted ops; purge critic on the grafted tree; Documents migration run on the user's go.

### Wave 3 (planned)

Compile, deterministic, and attached-session proof of one capture, edit, apply loop per route; ledger sweep; this map deleted.
