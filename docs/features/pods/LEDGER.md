# Portable Pods Ledger

Rewritten 2026-09-16 after the pod/product boundary grill. Git holds the earlier form.

## Decided

- 2026-09-16: A pod is one folder of plain source: scripts with declared entrypoints, JSON members, assets. Typed JSON is reusable data. A library owns the operation and the domain validation; storage knows no domain rules.
- 2026-09-16: Composition (`$include`, `$preset`) stays. The user's own standards use 271 directives across 76 files, and fragments are the only way to manage a standard. `$schema` is the only member-level selector; typed filename suffixes are removed because 142 of 150 real members have none.
- 2026-09-16: Publish vendors, it does not precompose. Every consumed foreign fragment is copied under `settings/_vendor/<pod-id>/...` and the reference is rewritten to `@local/_vendor/...`. A published pod composes from its own bytes only, so it never needs a sibling pod. Vendored files are the inspection copies.
- 2026-09-16: Local foreign references (`@global/...`) resolve by the installed pod whose manifest `id` matches, with no hash pin. Two matches fail and name both folders. Folder names remain addresses, never identity.
- 2026-09-16: Identity is three facts: folder address (physics), manifest `id` (lineage, a stored human claim), and per-file SHA-256 (derived, never stored). Pod content hash is derived on demand. `requires`, `parent`, `origin`, and `release.json` are removed because each is a stored claim about bytes elsewhere and needs reconciliation code to catch drift.
- 2026-09-16: Provenance is one `imported.json` receipt written at import: archive hash, locator, date. It is non-semantic, excluded from the content hash, never validated, never gates execution.
- 2026-09-16: Pod-level preparation gates only manifest structure and entrypoint source. JSON members validate individually when used, by the library the `$schema` names. One bad member never hides the pod's other members from a product route.
- 2026-09-16: Validation lanes stay separate: structural schema runs in the host with ajv and works offline; composition and semantic validation run through the native bridge and appear when a Revit session attaches. Web-only editing without Revit is schema-checked only, on purpose. C# libraries are not hosted outside Revit.
- 2026-09-16: One member editor (form and raw JSON are two modes of one draft) is embedded in the product routes as the apply-source panel. Capture creates a new member and lands in place with it selected; the user never leaves the route to see what they captured. The Pods route is a browser that opens the same editor.
- 2026-09-16: `/schedule-grid` is renamed `/schedules`. It keeps both verbs on separate affordances: "push" writes cell values, "apply" writes a schedule definition from a member. Capture of a schedule is spec only, never cell values.
- 2026-09-16: Capture always creates a new member. Apply requires saved content. Preparation is an internal snapshot step, not a user-facing stage or artifact.
- 2026-09-16: APS is the sole authority for parameter definitions; execution retrieves current definitions. Failed pagination cannot return a partial snapshot. APS is never bundled in a pod.
- 2026-09-16: Documents/Pe.Tools holds preferences.json and Pods/<local folder>. Hard replace, no migration code. Cache, credentials, installed binaries, and transient state live elsewhere. Outputs and receipts live under the pod's excluded output directory.
- 2026-09-16: A member is addressed as `{ pod: <manifest id>, path: <relative path> }` everywhere. `moduleKey` and `rootKey` are removed; `$schema` alone says what a JSON member is for, resolved by the host's `settingsSchemaProvider` mapping.
- 2026-09-16: Schedules get `schedule.capture` and `schedule.apply` bridge ops mirroring the family pair. Desktop palettes stay as the quick Revit entry for family manager, family migrator, and schedule manager; they call the same ops as the web routes.
- 2026-09-16: Family and families apply write the same pod receipt as schedules, into the current pod's `output/<run>/`: pod id, member path, member SHA-256, op id, plan hash, outcome, output references.
- 2026-09-16: The host is the only reader of the pod folder. It composes one member through a per-member bridge prepare and passes composed JSON inline to plan and apply.
- 2026-09-16: Pea reads and edits members through the settings document ops and applies through the same route commands as the UI. The capability catalog keeps enumerating script entrypoints only.
- 2026-09-16: The Pods route is the thinnest view over op-projected data: browser, member editor, receipts. Script pods keep `entrypoints` and `PeScripts.csproj`; JSON-only pods need neither.
- 2026-09-16: Plan is the confirmation sheet of Apply, never a stage or page. Only `/families` needs a real plan because it runs an expensive bulk operation that cannot be rerun cheaply. A family diff is a nicety. Schedules have no plan: apply creates a new schedule every time.
- 2026-09-16: Normalization shape S2, "one route kernel": one route definition (entity, target kind, schema, capture op, apply op) drives `/family`, `/families`, `/schedules`; engines expose one outer edge (`Capture`, `Apply`, and `Plan` where needed); palettes and bridge ops are adapters over it; the legacy settings hierarchy, precompose/release code, typed suffixes, whole-pod catalog, and prototype variants are deleted.
- 2026-09-16: Purge means fewer lines, less complexity, and fewer invalid states for the same features. It never removes a feature or function.
- 2026-09-16: The crusade runs on branch `crusade/normalize`, cut from the pod/settings rewrite at this commit, and lands on `main` once.
- 2026-09-17: One thread binds one Revit document. "A single thread should only have one canonical document bound." The thread head is the one target store; every product route and every chat pane reads and writes it; the URL carries the thread, and a `?target` pin is a view, never a second store. A second document is a second thread. (Demiurge round 1, shape A2.)
- 2026-09-17: The audit stage is a live read of the target's entity into an in-memory draft; capture and apply are "save this draft as a member" and "write this draft to Revit". A pod appears at save, not at audit. `/family` stops requiring a saved member to look at a family. One draft shape per entity serves the audit table and the spec editor; on schedules, cell values are a section of the spec that capture omits. (Shape B1; the user: "if it makes sense architecturally and/or could help us code share and consolidate then I'm in".)
- 2026-09-17: A draft is thread-owned Work, not route-owned page state. Pea proposes into it from chat without the route being open; the inline chat card renders the same proposals band the route renders; the user opens the route to see the whole table. "User asks to rename a param across the entire project, then the inline rendered proposal in chat surfaces it to the user, and the user can open the route to see. That is my dream."
- 2026-09-18: Composition retains the exact consumed root and dependency bytes once; effective JSON is a decoded view and never source-byte authority.
- 2026-09-18: Family build/apply and schedule apply write immutable `input.json` evidence plus byte-exact `effective-input.json` before native effects, and receipts retain both paths for admitted outcomes. Authored root/dependency bytes and reviewed Work revisions remain owed because these native callers do not receive them.

## Tried & rejected

- 2026-09-16: Binding library operations to authored JSON manifest entries; this makes reusable data look executable.
- 2026-09-16: Whole sibling-pod embedding and bundled/cached APS authority; vendor consumed fragments instead and retrieve current external authority at execution.
- 2026-09-16: Equating a folder name with lineage identity; an Explorer rename must not invalidate a pod.
- 2026-09-16: Precomposed releases carrying `composed/`, `requires` with release hashes, `parent`, `origin`, and `release.json` integrity, plus an explicit `--independent` import that flattens. Every one of these is a stored claim about absent bytes; `ScriptPodPreparationService.cs` spent about 90 lines reconciling them. Vendoring at publish gives the same stability from local bytes with no reconciliation.
- 2026-09-16: Typed filename suffixes (`.family.json`, `.schedule.json`, ...) as a validator selector; duplicates `$schema` and rejects nearly all real members.
- 2026-09-16: Whole-pod gating in the settings catalog (`PreparedPodSettingsCatalog.List` drops a pod on any error); one stray member hid valid families.
- 2026-09-16: Whole-pod snapshot hash as receipt attribution; an edit to an unrelated member changes every future receipt's source. Attribution uses member path plus member SHA-256.

## Owed

- Bind Plan and Apply to one reviewed Work revision and retain authored root and dependency bytes when composition contributes them; the native input output currently proves only the effective JSON and evidence available at its call boundary.

- Publish transform: vendoring in `ScriptPodArchiveService.cs`. Accept when a pod that references `@global/_fields/Header` publishes, imports on a machine with no `global` pod, and composes without error; the vendored file is byte-identical to the source.
- Manifest: remove `requires`, `parent`, `origin`, `externalRequirements` gating from `PodManifest.cs`; keep `schemaVersion`, `id`, `name`, `version`, `description`, `entrypoints`. Accept when `PodManifestValidator` rejects the removed fields as unknown.
- Preparation: `ScriptPodPreparationService.cs` gates only manifest and entrypoints; composition runs per member on request and returns that member's diagnostics only. Accept when a pod with one malformed member still lists its other members in Family Foundry.
- Reference resolution by installed `id`, no hash. Accept when renaming the `Global` folder in Explorer does not break a `@global` reference, and a duplicate `id` reports both folder paths.
- `imported.json` written by import; excluded from hash; never read by a gate. Accept when deleting it changes nothing observable except the provenance display.
- Receipts: `PreparedPodSettingsCatalog.cs` attribution records pod `id`, member path, member SHA-256, operation, outcome, output references. Accept when editing a different member leaves a re-run's source identity unchanged.
- Host: `settings.ts` composition preview calls a per-member prepare op and stays schema-only when no bridge is attached, with a reason the editor shows. Accept when the web editor renders a `$include` member offline with a "composition needs Revit" notice instead of an error.
- Product routes: embed the member editor as apply-source panel; capture lands in place. Protoui round owed for the table-beside-draft layout on `/family`, `/families`, `/schedules`.
- Rename `/schedule-grid` to `/schedules`; separate "push" and "apply" affordances. Accept when the route tree, MCP route commands, and skills name `/schedules`.
- Member write op (`pod.member.write` or widened `settings.write`): pod id, path, bytes, refuse overwrite, return SHA-256. Accept when capture on `/family` creates a file the Pods route lists without reload.
- Schedule bridge ops `schedule.capture` and `schedule.apply` in `Pe.App/Host`. Accept when `/schedules` captures a spec and applies it to a second project with a receipt.
- Families route reads a pod member, not `moduleKey: "FamilyFoundry", rootKey: "patches"` (`family-actions.ts:505`).
- Migrate the user's local `OneDrive/Documents/Pe.Tools` to `Pods/<folder>` shape by a one-shot destructive script after committing; the old tree is deleted.
- Prove actual Family Foundry and Schedules operations with current APS resolution in a controlled checkout session; constructor, deterministic, and compile checks do not prove this workflow.
- Add Git/cloud transport only when its concrete workflow is selected; archive transport is the present carrier.
- Migrate `PodMembers.Load` and native plan/apply adapters to the captured composition source; run outputs must include that source before native/run-output acceptance.
