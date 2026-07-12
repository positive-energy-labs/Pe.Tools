# /family-types — web Family Types dialog replacement

Rebuild of /family-sheet on the route-state collaborative-UI pattern, with doc-lab grounding,
formula validation, and ancestry. Greenfield, no back-compat. Grounding docs (read first in
every brief): `GROUNDING-WIRING.md`, `GROUNDING-REVIT.md`.

## 1. Decisions locked (do not relitigate)

- **Three universal tools** — `route_state_read`, `route_state_apply`, `route_command` — replace
  the six `family_sheet_*` tools, which are DELETED. Per-route code = one zod schema + write
  mask + command handlers. (User handoff.)
- **Agent proposes, never commits.** Declarative agent-writable path mask, default-deny,
  introspectable via `route_state_read`. Agent-writable: `cells.*.proposal`, `cells.*.review`.
  Denied: `staged`, `pushedAt`, `snapshot`, `doc` (those move via commands/human).
- **Handlers run where the controller lives**: dispatcher registry + HTTP endpoints on the
  agent-controller web app (`/pe/route-state...`, host process). Tools are thin HTTP clients →
  they work from pea runs AND stdio agents identically. Browser writes go through the same
  endpoints with `actor: "human"` (unmasked). No client-side merges.
- **Commands (ruthlessly short, 3)**: `parse_spec` (OCR via LlamaParse), `refresh_snapshot`
  (family.editor.snapshot), `push` (human-only; family.editor.apply + fold staged + pushedAt).
  If a fourth is ever needed, that's a finding to report, not a patch.
- **Core vs UI state**: session doc holds durable collaborative state only. Geometry/bboxes
  stay out — markdown blocks + parseId in state, grounded view refetched from parse cache.
- **Cell model kept** (proven): `cells: Record<"param::type", {proposal?, staged?, review}>`,
  `@formula` sentinel, display precedence staged ?? proposal ?? snapshot.
- **Route** `/family-types`, state key `route:family-types`. `/family-sheet` route + `src/family-sheet/`
  + six tools deleted. `/doc-lab`, `/family-audit`, `/family-doc` untouched this pass (ledger).
- **Formula validation, two layers**: client-side TS (tokenizer/deps/cycles from snapshot — instant
  UX) + authoritative host-side (`family.editor.apply` wired through `Formula.TrySetFormula`,
  plus `dryRun` flag for pre-commit validation).
- **Ancestry/offspring**: snapshot extended with `dependsOn`/`dependents` (formula graph) and
  `associations` (dims/arrays/nested via GetAssociated) — one level deep. Multi-level nested
  traversal has no precedent and is deferred (ledger).
- **changedKeys granularity deferred** until it measurably hurts. Hydration-nudge hack replaced
  by dispatcher GET.
- **Tree discipline**: other agents own the Takeoffs/scripting dirty files. Stage only files this
  workstream touches; mixed-ownership dirty files (RevitBridgeOps.cs, RevitDataRequestService.cs,
  host-ops.generated.ts) get additive edits and are flagged at commit time, not bulk-committed.
- **RRD avoided** until Phase 5 (typegen + live verify). Restart freely if needed; always reopen Chadds.

## 2. Delegation

- Fable (orchestrator): plan, cross-agent contracts, seam work, centerpiece review (dispatcher +
  mask), integration, git, ledger, e2e driving.
- Opus subagents: Wave 1A (TS contracts/dispatcher/tools), Wave 1B (C# snapshot+apply extension),
  Wave 2C (web UI route — taste gate: orchestrator reviews UI personally).
- Fences: 1A = packages/{agent-contracts,runtime,mcps} · 1B = Pe.Shared.RevitData/Families,
  Pe.Revit.Global/Services/Host, Pe.Shared.HostContracts/Operations (additive only) ·
  2C = apps/web/src/family-types + routes. Nobody touches Pe.Revit.Takeoff/ or Pe.Revit.Scripting/.

## 3. Cross-agent contracts (fixed verbatim, both sides)

- Snapshot parameter extension: `dependsOn?: string[]`, `dependents?: string[]`,
  `associations?: { dimensions: string[]; arrays: string[]; nested: { elementName: string;
  elementId: string; paramName: string }[] }` (nullable/loose on TS side).
- `FamilyEditorApplyRequest` gains `dryRun?: boolean` (validate, no commit).
- Patch op shape: `{ path: string; value?: unknown }[]` — dot paths, `value` absent = delete key.
- Endpoints: `GET /pe/route-state` (list) · `GET /pe/route-state/:route` (doc+schema+mask) ·
  `POST /pe/route-state/:route/apply` `{ actor, patches }` · `POST /pe/route-state/:route/command`
  `{ actor, command, input }`. All JSON; zod-validated post-patch; rejection returns the zod
  error as actionable hint.

## 4. Phases

- **P0 Ground truth** — explorer reports → grounding docs, plan, ledger. Commit docs.
  Exit: docs committed; baseline `vp check` state recorded. ✅ gate = this doc exists.
- **P1 Route-state core (TS)** — Wave 1A. Generic spec (`defineRouteState` v2: key, schema,
  agentWriteMask, commands), family-types doc schema, dispatcher registry + HTTP endpoints in
  packages/runtime agent-controller-web, three tools in mcps/pea, delete six tools + old schema
  section. Exit: vertical test (masked path rejected w/ hint; allowed patch applies; command
  dispatches), `pnpm check` green in touched packages, tools listed in pea profile.
- **P2 Host ops (C#)** — Wave 1B, parallel with P1. Extend snapshot with deps/associations, wire
  TrySetFormula into apply, add dryRun. Exit: `dotnet build` green; behavior tests for the
  validation path where Revit-free; typegen deferred to P5 (needs live host).
- **P3 Web UI** — Wave 2C after P1 lands (real export surface pasted in). `/family-types` route:
  grid (params×types, grouped), formula column w/ live TS validation (deps/cycles/invalid refs),
  ancestry panel (dependsOn/dependents/associations paths), DocPane camera + upload → parse,
  review/stage/push UX over dispatcher endpoints. Exit: route renders live against dispatcher
  with mock/sample doc; browser-verified (screenshots); orchestrator taste pass.
- **P4 Integration & squash** — orchestrator: seams (tool→endpoint auth actor, parse cache
  cross-process, PE_WEB_URL), delete /family-sheet, ledger review, commit waves.
  Exit: cold-start agent (this session, stdio) completes read→propose flow with ONLY the 3 tools.
- **P5 E2E live** — RRD up (restart if needed, open Chadds), open a family in the editor, typegen
  regen + `--check`, full loop: upload spec PDF → OCR → agent proposes w/ provenance → human
  review in browser (orchestrator drives) → push → re-snapshot proves values in Revit. Evidence:
  screenshots + snapshot diff. Exit: loop proven, THEN PAUSE — final step is live collaboration
  with the user on a real spec doc.

## 5. Ledger

`LEDGER.md` sibling. Any agent finding an out-of-scope issue adds a line, never fixes. Phase
exits require a ledger review.
