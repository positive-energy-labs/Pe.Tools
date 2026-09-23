# ops ledger

`/ops` is the host op runner: the situation ladder picks the target, the catalog picks the op, `lib/schema-to-field-render` draws the request form, `callHostRpc` runs it, a generic receipt shows the response. A per-op renderer is opt-in.

## Decided
- 2026-09-15, `/ops` consumes repo primitives and forks none. The five prior run rebuilds (`69c9c7f`, `ca31237`, `c7086fc`, `f79d5c9`, and the era-1 console) each made ops the proving ground for a new framework; that is the failure mode this ledger exists to stop.
- 2026-09-15, the runtime catalog stays live from `GET /ops` (`apps/host/src/ops-catalog.ts`). A Revit op cannot run without a session, so a form that needs a session costs nothing, and live cannot drift.
- 2026-09-15, a per-op renderer exists only when it draws what the response schema cannot. Eleven views pass that bar: `revit.detail.sheets`, `revit.detail.electrical-panel-schedules`, `revit.detail.schedules`, `revit.detail.parameter-links`, `revit.matrix.parameter-coverage`, `revit.matrix.schedule-coverage`, `revit.matrix.loaded-families`, `revit.resolve.references`, `revit.catalog.project-browser`, `revit.catalog.project-index`, `revit.context.summary`. The other 24 registered views are tables a generic receipt renders.
- 2026-09-15, the renderer map is a plain object beside the ops manifest, op key to optional input and output components. `RouteManifest.views` is deleted; it was `() => null` stubs nothing read.
- 2026-09-15, glance views and `SyntheticRunner` composed ops live under `src/lab/` and mount at `/lab`; they are not part of the runner.
- 2026-09-15, `/ops` is both runner and receipt inspector, keyed by action id; chat and instances link into it through `ActionReceiptView`. Reads render the returned value in a generic result pane; mutations render the journaled receipt. The renderer map's output component plugs into both, so a chat receipt draws the same view as a run.
- 2026-09-15, the URL is the page: `?op`, `?target` (the shell's grammar), `?actionId`. Form values and a read's value are render state. `OpsPage`, the store atoms, and `OpsReceipt` are deleted.
- 2026-09-15, hotkeys reuse the three tiers in `route/keys.tsx`: route chords for run, next op, previous op; the picker ladder for op selection; pane-tier caret movement between form fields. No new navigator.

## Tried & rejected
- 2026-09-15, folding every `RouteAction.run` into an op key so `/ops` becomes the generic view of any route; rejected because routes own Work documents and are multi-step, ops are one call, and the fold removes the document-owned versus session seam.
- 2026-09-15, emitting request schema JSON from `host-typegen` so the form works offline; deferred, not needed while the only consumer runs against a session. Revisit when chat composes op calls offline.

## Owed
- Prove a bridge op end to end on an attached Revit session: the form draws `x-options` through the `field-options` Reading, and a mutation lands in the journal and shows in `ActionReceiptView`. Proven so far: `host.topology` from the sentence, `POST /call` 200, on the dev session 2026-09-15.
- 2026-09-22, the test bar sweep deleted 1 SCAFFOLD test files with no surface replacement. Each behavior they asserted needs a surface test (CDP journey, MCP tool call, host HTTP) or a visible readout. Recover the assertions from git: `ops/ops`.
- Prove a bridge op end to end on an attached Revit session: the form draws `x-options` through `revit.catalog.field-options`, and a mutation lands in the journal and shows in `ActionReceiptView`. Proven so far: `host.topology` from the sentence, `POST /call` 200, on the dev session 2026-09-15.
- `ReadingSpec` sees the page and Work but not the resolved target, so `workspace.tsx` reads the session-scoped catalogue with `useReading` beside the manifest instead of declaring it. Owned by the route substrate.
- Route chords for next and previous op, and pane-tier caret movement between form fields; `Mod+Enter` runs today.
- Declare `@pe/mcps` in `apps/web/package.json` or stop importing it by relative path; `ops/run.ts` is one of the importers.
- Field options have no value domain for levels, views and sheets, schedule names, model family type names, materials, fill patterns, text and dimension types, worksets, phases, design options, or units outside schedule formatting; each lands as one registered key (`ValueDomainKeys`) read through the `field-options` Reading.
