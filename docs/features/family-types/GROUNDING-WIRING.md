# Route-state + family-sheet wiring grounding (verified by source-index, 2026-07-12)

Root: `source/pe-tools`. Read before touching any of these seams.

## The generic seam (keep, extend)

`packages/agent-contracts/src/route-state.ts` lines 17–38 are the ENTIRE generic core:

```ts
export interface RouteStateDef<TSchema extends z.ZodType> { key: string; schema: TSchema }
export function defineRouteState(def) { return def }
export function readRouteState(sessionState, def): z.infer<TSchema> | null  // safeParse, null on invalid
```

Everything below line 40 is family-sheet-specific (worksheet/cell/proposal schemas, cell-key
helpers `param::type`, `@formula` sentinel) — replaced in the rebuild.

## Session state mechanics (verified against @mastra/core 1.50.x .d.ts)

- `/pe/info` → `{ controllerId, resourceId }` — defined in `packages/runtime/src/agent-controller-web.ts:111`;
  mounted into the host Hono/Effect router by `apps/host/src/mastra-runtime.ts:152-159`.
- Browser: `MastraClient.getAgentController(controllerId).session(resourceId)` → `session.subscribe`
  + `session.setState({key: value})` (top-level merge).
- Tools (inside a pea run): `context.requestContext.get("controller")` →
  `{ getState(), setState(partial), updateState(updater) }`. `updateState` is the serialized
  read-modify-write transaction: `(state) => ({ updates, events?, result })`.
- `state_changed` wire payload: `{ type, state: full map, changedKeys: string[] }` — changedKeys
  EXISTS on the wire (required in core) but Pe's `workbench/wire.ts:178-182` types it optional and
  ignores it. Per-key invalidation is available without a core change; defer until it hurts.
- State is PER-SESSION (per-session bus; resourceId binds browser tab + pea to the same worksheet).
- No raw-state GET endpoint exists → `useRouteState` does a `session.setState({})` hydration nudge
  (route-state.tsx:93-94, marked ponytail). The rebuild's dispatcher endpoint should also fix this
  properly (a GET that returns the state doc).
- SIZE CONSTRAINT: state_changed rebroadcasts the full map on every write. Geometry/bboxes/
  screenshots stay OUT of session state; store markdown + parseId, refetch grounded view from
  the parse cache (`/api/pdf-audit/parse/:jobId`).

## `useRouteState` — `apps/web/src/workbench/route-state.tsx`

`useRouteState(def) => { slice, hydrated, setSlice(next), peaActive, connected, error }`.
Optimistic whole-key write, authoritative echo via state_changed. Standalone (no WorkbenchProvider).
`peInfoSchema` duplicated in provider.tsx — known wart.

## The six family_sheet_* tools (to be DELETED, handlers become mask + commands)

`packages/mcps/src/pea/family-sheet.ts`. status/doc = reads; propose/mark = writes proposal/review
(never `staged`); refresh → host op `family.editor.snapshot`; parse_spec → POST
`${PE_WEB_URL ?? localhost:3010}/api/pdf-audit/parse` (LlamaParse), writes markdown blocks + parseId.
Registered by spread into `peaProductTools` in `packages/mcps/src/pea/index.ts:280-293` via
`createRuntimeToolProfile`. Trust contract enforced only by code (tools bypass the
host_operation_call access gate — they use HostRpcCaller directly).

## Host ops that ALREADY EXIST (generated contracts, host-ops.generated.ts)

- `family.editor.snapshot` req `{}` → `{ familyName, currentTypeName, typeNames[], parameters:
  [{ name, isInstance, isReadOnly, isDeterminedByFormula, isShared, guid?, storageType, dataType?,
  group?, formula?, valuesPerType }] }` — maps 1:1 onto the sheet snapshot.
- `family.editor.apply` req `{ edits: [{ paramName, typeName?, value?, formula? }] }` →
  `{ applied, results: [{ index, ok, error? }] }` — one host-owned transaction, per-edit results.

C# side: `source/Pe.Revit.DocumentData/Families/Extraction/FamilySnapshotExtractor.cs`,
`source/Pe.Revit.FamilyFoundry/Capture/ParameterSnapshotCollector.cs` (verified locations only —
bodies not yet indexed; verify before extending).

## /family-sheet UI (rebuild target)

`apps/web/src/family-sheet/` + `routes/family-sheet.tsx`. Store seam `FamilySheetStore`
(store.tsx:38-65) with Mock + Live providers; Live uses useRouteState + structuredClone-mutate-
setSlice. SheetGrid groups by param.group, columns = Parameter | Formula | per-type.
Display precedence: staged ?? proposal ?? snapshot. push() = family.editor.apply w/ script
fallback (values only). Grounded doc (full geometry) lives in LOCAL React state keyed by parseId.

## Facts fixed for all briefs (cross-agent contracts)

- Session-state key for the new route: `route:family-types`
- Route path: `/family-types`; old `/family-sheet` + `src/family-sheet/` + the six tools DELETED.
- Parse endpoint stays: `POST /api/pdf-audit/parse` (multipart), `GET /api/pdf-audit/parse/:jobId`.
- Web dev port: 3000 (launch.json) — note family-sheet.ts had a stale 3010 default. Use
  `PE_WEB_URL ?? "http://localhost:3000"`.
- LLAMA_CLOUD_API_KEY lives in `source/pe-tools/.env` (verified present).
