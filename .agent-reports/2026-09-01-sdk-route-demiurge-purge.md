# SDK and route clean-line adversarial review

## Verdict

The change has the correct outer shape but does not yet hold the accepted lifecycle contract.

- **KEEP** the deletion of document-scoped Instances state.
- **KEEP** `RouteDocument.empty` as a narrow scope seam and keep document acquisition in Takeoffs.
- **DELETE** the browser-authored lifecycle booleans and unused SDK `DocOpenResult` / `DocCloseResult` mirrors.
- **RESHAPE** session and document actions around the staged records that the SDK already returns.
- **RESHAPE** URL handoff so live and fixture Instances use one target, and so Takeoffs carries the selected world across document acquisition without writing it into the previous document.
- **RESHAPE** beta.137 release provenance before treating its generated contract as current.

Do not build an omniscient route controller. The smallest surviving shape is a shared address gate, route-owned acquisition, generated SDK result types, and URL state only for navigation handoff.

## Review boundary and proof

Source lane only. I inspected Pe.Tools at `f3b1e9899741c0175669615ed9b3b605afa065c9` and the 206-addition / 86-deletion unstaged diff. I inspected Pe.Revit.Sdk at clean commit `130a2f9eb543b6d84cb7f7aa7dfc0ad46f15928a`, declared as beta.137. I started no Revit or browser process.

The deterministic SDK console suite falsified beta.137 contract provenance:

```text
dotnet run --project source/Pe.Revit.Loader.Tests --no-build
exit 1
Unhandled exception. System.InvalidOperationException:
generated provenance must equal the declared release version
... ClientContractTests.cs:line 72
```

`git diff --check` on Pe.Tools returned exit 0. This proves whitespace integrity only.

## Census

### Pe.Tools unstaged content

| Area | Paths | Shape |
|---|---|---|
| Instances scope | `apps/web/src/instances/route.tsx`, `instances/workspace.tsx`, `routes/instances.tsx`, `routes/-instances.test.tsx` | Removes `RouteDocument` and moves live world target into `?target=`. |
| Fake route contract deletion | `packages/agent-contracts/src/instances.ts`, `index.ts`, `route-bindings.test.ts`, `packages/mcps/src/pea/routes.ts` | Deletes the document-scoped `instancesRouteState` and its registrations. |
| Shared document gate | `apps/web/src/workbench/route-document.tsx`, `route-document.test.tsx` | Adds an `empty(sessions)` render seam. |
| Takeoffs document acquisition | `apps/web/src/takeoff/route.tsx`, `route-workspace.tsx`, `store.ts` | Adds route-local recent-document UI and attempts to move the URL after world/document changes. |
| Other dirty content | `docs/features/takeoffs/LEDGER.md`, `apps/pea/src/prompt.ts` | Outside the four accepted forms. Preserve; this review does not adjudicate it. |

`source/Pe.Revit.DocumentData/AgentContext/RevitAgentContextCollector.cs` appears as modified in `git status`, but its worktree hash equals the index hash (`67f5f736...`) and `git diff --quiet` returned 0. It has no content delta. Do not stage it as review work.

`.agent-reports/` already contained other untracked reports and images. This report is the only file this review added.

### SDK commit 130a2f9

The commit changes only:

- `source/Pe.Revit.Bridge/BridgeApplication.cs`: one private `ElementIdText(ElementId)` helper used by both external-reference result paths.
- `product.payloads.json`: beta.136 to beta.137.
- `samples/HelloAddin/global.json`: beta.136 to beta.137.

The ElementId change does not alter session, document, or route contracts. The release bump exposes an existing generated-contract failure because `clients/ts/generated/pe-revit-contract.ts:2` still says beta.136.

## Exact verdicts

### KEEP: delete fake document-scoped Instances state

**Evidence**

- The deleted `packages/agent-contracts/src/instances.ts` defined `instancesRouteState` as a document schema whose only payload was `bindings` and described a machine route as document-scoped.
- The diff removes its export from `packages/agent-contracts/src/index.ts`, its MCP registration from `packages/mcps/src/pea/routes.ts`, and its inclusion in `route-bindings.test.ts`.
- `apps/web/src/instances/route.tsx:107-131` now mounts `InstancesWorkspace` directly from the machine-wide fleet instead of asking `RouteDocument` for an address.
- `apps/web/src/routes/-instances.test.tsx:127-145` now proves one all-session fleet query and a cockpit that mounts without a document.

**Why it survives**

Instances owns machine census and world lifecycle. A Revit document does not own either. The deleted route document had no independent truth and no commands. Restore none of it.

### KEEP: URL target for live Instances

**Evidence**

- `apps/web/src/routes/instances.tsx:7-30` validates `target` and replaces the current URL when the selected world changes.
- `apps/web/src/instances/workspace.tsx:122-131` reads the selected world from the supplied target and keeps only visual stage state local.

**Why it survives**

The URL records navigation, not machine truth. The fleet remains the machine authority. This is the correct replacement for route-document persistence.

### RESHAPE: fixture Instances still has a second target authority

**Evidence**

- `apps/web/src/routes/instances.tsx:21-47` passes URL `target` and `setTarget` to `InstancesRouteContent`, but the fixture branch discards both.
- `apps/web/src/instances/fixture.tsx:174-182` creates a second `useState("")` target.

**Falsifier**

`/instances?source=fixture&target=<world>` validates the target but does not select it. Live and fixture versions of one route now disagree about URL state.

**Smallest reshape**

Pass `target` and `setTarget` into `FixtureInstancesPage` and delete its local target state. Add one route test that loads fixture mode with a target and observes the selected row.

### KEEP: narrow `RouteDocument.empty` seam

**Evidence**

- `apps/web/src/workbench/route-document.tsx:81-97` still owns only address resolution. Its new `empty` callback receives sessions but performs no open operation and knows no Takeoffs state.
- `apps/web/src/takeoff/route.tsx:95-104` supplies the route-owned `TakeoffsDocumentOpen` view.
- `apps/web/src/workbench/route-document.test.tsx:60-69` proves the callback can render with zero worlds.

**Why it survives**

This is the correct limit for sharing. It reuses the document scope primitive but does not turn it into a controller for every route. Keep the seam. Do not add opening, recents, route bindings, or product decisions to `RouteDocument`.

### KEEP, then RESHAPE: route-owned Takeoffs acquisition

**Keep** the ownership and composition in `apps/web/src/takeoff/route.tsx:107-183`. It reuses `RouteHead`, `DocGroup`, `DocRow`, `EmptyState`, and `documentTrunk` instead of creating a universal picker/controller.

**Reshape the data flow** because:

- `TakeoffsDocumentOpen` selects a world at `route.tsx:110,118`, but that selector disappears when it navigates at `route.tsx:128-129`.
- The mounted store reads its world only from the new document's persisted binding at `store.ts:375-380`. A newly opened document can therefore arrive with no selected world even though the acquisition view had one.
- The recents query uses one machine-wide key and calls `documentTrunk.recents()` at `route.tsx:113-116`; the established Takeoffs store already scopes recents by `session.year` at `store.ts:475-488`.
- Navigation uses the requested `modelGuid ?? path` before the route has observed the active document at `route.tsx:120-129`.

**Smallest reshape**

Use the existing URL target convention as the route-local handoff. Query recents by the selected session year. Carry `{ doc, target }` through navigation. Mount the new document store from that target when no document binding exists, then let the document-owned binding become authority. Delete the handoff from the URL after the binding lands. Do not teach `RouteDocument` about targets or document-open operations.

### DELETE: boolean document-open projection

**Evidence**

- `apps/web/src/targeting/world.ts:271-291` casts the response to `Envelope<DocOpenResult>`, checks only `state === "ok"`, and returns a display string.
- `apps/web/src/takeoff/store.ts:891-908` catches every failure and returns `true` or `false`.
- `apps/web/src/takeoff/route-workspace.tsx:113-125` uses that boolean to navigate to the requested document.
- The same `setBindings` method both persists document route state and opens a Revit document at `store.ts:939-990`.

**Falsifier**

The SDK has at least three stages after resolution: request identity, transport/frame result, and terminal operation response. A boolean cannot distinguish `transport-lost` from a terminal refusal, so it cannot tell the caller to recover by `op result`. It also cannot carry the observed document returned by the bridge.

**Delete**

- Delete `pickDocument(): Promise<boolean>` and its catch-all.
- Delete the document-open side effect from `actions.setBindings`.
- Delete the `opening.then(opened => ...)` navigation branch from `TakeoffsPage.setState`.

**Replacement**

Keep `setBindings` as persistence only. Put the route-specific open action beside `TakeoffsDocumentOpen` / the Takeoffs document picker. Return the SDK result record, preserve its request id and response, invalidate existing session/document feeds, then navigate only from the observed active document address. This uses existing primitives and creates no controller.

### RESHAPE: browser session lifecycle collapses the SDK contract

**Evidence**

- SDK `CoreContracts.cs:197-213` exposes separate start, hot HR, cold HR, failure, and stop result records. Cold and failure records carry `legs`, `reopened`, and `dropped`.
- Pe.Tools Host promises to relay that envelope untouched at `apps/host/src/session-route.ts:16-28`.
- The browser replaces it with `WorldLifecycleReceipt { action, ok, state: string, diagnostics, nextSteps }` at `apps/web/src/targeting/world.ts:41-47,96-106`.
- The browser test injects impossible state `"refused"` at `apps/web/src/routes/-instances.test.tsx:258-273`. `refused` is not in SDK `SessionHrResultState` (`CoreContracts.cs:72-77`). The test proves the mirror accepts states the SDK contract forbids.

**Verdict**

Delete `WorldLifecycleReceipt.ok` and the generic string result. Consume a union of the generated start/HR/stop result records per action. Preserve `legs`, `dropped`, `reopened`, and the controlled session projection. Derive the displayed outcome from the typed SDK state. Keep the Host relay unchanged.

This is a route-local consumer reshape, not a reason to create a cross-product lifecycle controller.

### DELETE and RESHAPE: fake SDK document result contracts

**Evidence**

- SDK `CoreContracts.cs:220-223` declares `DocOpenResult` and `DocCloseResult`.
- No SDK command constructs either record. The only references are their declarations.
- `DocCommand.cs:225-295` actually emits `StateResult`, `DocRequestResult`, `DocFrameResult`, or `DocOperationResult` across the document operation stages.
- Pe.Tools casts `/docs/open` to the unused `DocOpenResult` at `apps/web/src/targeting/world.ts:288`.

**Verdict**

Delete `DocOpenResult` and `DocCloseResult`. They are generated hand mirrors of a result shape that does not exist. Keep the records that `DocCommand` emits. Type their `state` properties from the existing verb-state authority so generated TypeScript cannot widen every stage to `string`.

Do not add a second authored Pe.Tools contract. The generated SDK records are enough.

### RESHAPE: beta.137 contract provenance is false

**Evidence**

- SDK `product.payloads.json:2` declares `0.1.0-beta.137`.
- SDK `clients/ts/generated/pe-revit-contract.ts:2` declares `GENERATED_FROM = "0.1.0-beta.136"`.
- Pe.Tools pins beta.137 in `global.json:8` and `.config/dotnet-tools.json`, but its sole vendored client also declares beta.136 at `packages/host-contracts/src/vendor/generated/pe-revit-contract.ts:2`.
- The beta.137 nupkg contains the same beta.136-stamped client.
- SDK `ClientContractTests.cs:68-73` requires generated provenance to equal the declared version, and the deterministic run failed at that assertion.

**Verdict**

Regenerate the SDK client at beta.137, rebuild the package, and vendor that exact file into Pe.Tools. Do not edit `GENERATED_FROM` by hand. The C# public contract did not change in commit `130a2f9`, but the claimed release provenance is still false.

### KEEP: SDK `ElementIdText`

**Evidence**

- `BridgeApplication.cs:708-725` routes both external-reference success and census-error rows through one helper.
- `BridgeApplication.cs:731-738` selects `IntegerValue` only for `NET48` and `Value` for modern targets.

**Why it survives**

This is one private adapter around a Revit version seam. It removes duplicate warning blocks and has no route, persistence, or lifecycle authority. No broader element-id service is justified.

## Final clean shape

| Scope | Authority | Persistence | UI composition |
|---|---|---|---|
| Machine census | SDK `session list` plus exact Host bridge join | SDK receipts and process evidence | Instances reads it; no route document. |
| World selection | SDK session selector / exact observed world | URL during navigation; document binding only when a document-owned route needs it | Instances and fixture share one URL target. |
| Document selection | Observed active/open documents for one world | `?doc=` for tab identity; route document for feature state | `RouteDocument` gates address only; Takeoffs owns acquisition. |
| Lifecycle progress | Generated SDK result records and operation legs | SDK operation receipts | Route-local adapters render typed stages and diagnostics. |

The universal-controller candidate is **DELETE**. The current small shared gate plus route-local adapters is **KEEP**, after the typed-result and URL-handoff reshapes above.

## Stop

**FALSIFIED[source + deterministic, Pe.Tools `f3b1e98`, SDK `130a2f9`, 2026-09-01]:** the current diff removes the fake Instances document correctly, but browser lifecycle projections still collapse staged SDK truth, Takeoffs loses world authority across document acquisition, fixture Instances keeps duplicate URL state, unused SDK document result mirrors remain, and beta.137 ships a beta.136-stamped generated client.
