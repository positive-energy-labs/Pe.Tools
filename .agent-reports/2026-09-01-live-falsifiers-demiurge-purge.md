# Live falsifiers: deletion-first contract verdict

Static review only. Pe.Tools was read at `f3b1e9899741c0175669615ed9b3b605afa065c9` with the user's unstaged work present; Pe.Revit.Sdk was read at `ba5f58529cc1ff78c60fbc5ceecbac09ca72c805`. No Revit, browser, build, or process action was run. `docs/features/takeoffs/LEDGER.md` was not changed.

## 1. First adoption held the API thread for more than 13 minutes

### Verdict

**DELETE** both the former fixed two-minute timeout and the current cost-tier ten-minute replacement from `BridgeAgent.HandleRequestAsync` (`source/Pe.Revit.Global/Services/Host/BridgeAgent.cs:270-285`). The smallest truthful submission is `new RevitRunOptions { Label = op.Key }`.

`HostOperationCostTier` is agent discovery/cost metadata (`source/Pe.Shared.HostContracts/Operations/HostOperationContracts.cs:8-13,47-81`), not a cancellation contract. It cannot determine a safe deadline. The SDK explicitly defines a null timeout as “bounded only by the caller's token and process recovery” (`Pe.Revit.Sdk/source/Pe.Revit.Tasks/RevitTaskContext.cs:49-57`). A longer guessed number repeats the same lie later.

**RESHAPE** `BridgeAgent.HandleRequestAsync` to consume `RevitTaskQueue.RunForResult`, not the throwing `Run` projection, and map its existing outcomes to the durable receipt verbatim. Today `Run` throws on timeout/abandonment (`Pe.Revit.Sdk/source/Pe.Revit.Tasks/RevitTaskQueue.cs:70-76`; `RevitTaskResult.cs:68-93`), the generic catch writes `failed` (`BridgeAgent.cs:375-403`), and the `finally` clears the local busy marker (`BridgeAgent.cs:404-408`) although `AbandonedStillRunning` explicitly means the delegate still occupies the API thread (`RevitTaskResult.cs:33-38`; `WorkItem.cs:158-169`). That is the observed false terminalization.

Use the SDK's already-existing states: `Completed`, `Faulted`, `CancelledBeforeDispatch`, `CancelledCooperatively`, `TimedOut`, `AbandonedStillRunning`, `RefusedQueueUnresponsive`, and `RefusedQueueDisposed`. In particular, a caller cancel that fails to stop native work must persist `abandoned-still-running`, never `failed`. Do not invent a second Host lifecycle enum.

**DELETE** `_inFlightOperationKey` as a second busy authority once the typed queue lane is used. The TS broker already serializes each session (`source/pe-tools/apps/host/src/bridge.ts:541-637`), and the SDK queue already owns FIFO plus `Blocked` recovery. The marker is demonstrably false after abandonment because its `finally` runs while the API delegate continues.

### Binding root cause and narrow correction

**RESHAPE** carrier binding from a hidden side effect of adoption into an explicit, resumable Takeoffs prerequisite.

Evidence:

- `TakeoffCarriers.EnsureBindings` performs five document bindings in sequence, four of them instance-bound to Detail Items (`source/Pe.Revit.Takeoff/TakeoffCarriers.cs:29-58`). Revit then propagates each binding across the document's 9,212 Filled Regions.
- `SharedParameterBinder.EnsureProjectBinding` is cheap only when the GUID is already bound; a missing binding reaches native `BindingMap.Insert`/`ReInsert` (`source/Pe.Revit/Parameters/SharedParameterBinder.cs:84-107,57-75`). That native call has no cancellation checkpoint.
- `TakeoffAtlas.AdoptZones` invokes all bindings before touching the requested regions (`source/Pe.Revit.Takeoff/TakeoffAtlas.cs:92-119`), inside the same transaction as adoption (`source/Pe.Revit.Global/Services/Host/RevitDataRequestService.cs:56-58,158-175`). Therefore “adopt these regions” silently becomes a whole-document parameter migration.
- Adoption uses Role, Region GUID, Provenance, and the Project Information registry. `PE_M___RoomType` is not used until materialization/room-type work (`TakeoffCarriers.cs:60-103`; `TakeoffAtlas.cs:225-237`; `ZoneMaterializer.cs:122-150`). Binding it during first adoption is unnecessary work.

The concrete shape is:

1. A read-only Takeoffs preflight reports the exact missing carrier GUIDs and a typed state: `ready` or `needs-initialization`. This can be part of the existing Takeoffs snapshot; it needs no new controller.
2. One explicit, idempotent initialization request binds **one next missing carrier** in one transaction and returns `{ state: "progress", bound, remaining }` or `{ state: "ready" }`. The route repeats only while the returned state says progress. Each call gets its own durable receipt and returns Revit to the UI between the only natural chunks.
3. `takeoffs.adopt`, `takeoffs.partition`, and `takeoffs.room-type` stop calling `EnsureBindings`. They fail fast with a typed missing-prerequisite issue if their required carriers are absent.
4. Adoption initialization excludes `PE_M___RoomType`; materialization/room-type preflight adds it only when that stage is reached.

**DELETE** element-count chunking, polling timers, retries, and a generic “long operation framework.” The expensive unit is one opaque native binding insertion, not the selected adoption rows. There is no safe sub-element checkpoint inside `BindingMap.Insert`; the smallest real chunk is one binding per receipt/API context.

**KEEP** the proven Detail Items carrier mechanism and the existing stable GUIDs. Replacing them with another persistence technology or folding the carrier schema is unrelated to this falsifier and would orphan proven document data.

## 2. Reload retained `?doc=...` while another project-a copy became active

### Verdict

**KEEP** the document URL as route authority. `routeDocumentSearch` validates an absolute path or cloud model GUID at the root route (`source/pe-tools/apps/web/src/routes/__root.tsx:18,33-35`; `packages/agent-contracts/src/reading.ts:3-16`), and `routeDocumentTabHref` writes that exact address (`source/pe-tools/apps/web/src/workbench/route-document.tsx:44-47`). The reload falsifier proves the URL survived; it does not justify replacing it with shared selected-document state.

**DELETE/RESHAPE** the active-only inventory in `routeDocumentChoices`. It derives one choice from each session's `activeDocumentId` (`route-document.tsx:16-27`; `host/target.ts:108-110,113-132`). With two open documents in one Revit process, the requested inactive document is therefore classified as unavailable. `TakeoffsDocumentOpen` then offers MRU documents rather than the already-open set (`source/pe-tools/apps/web/src/takeoff/route.tsx:109-193`), and `documentTrunk.pick` refuses any target absent from recents (`source/pe-tools/apps/web/src/targeting/world.ts:271-291`). Those are fake constraints.

**REUSE** the existing `revit.context.document-session` response as the open-document inventory. It already returns `OpenDocuments`, `IsActive`, exact path, cloud model GUID, and document key (`source/Pe.Shared.RevitData/DocumentSessionContextContracts.cs:4-24`; `RevitDataRequestService.cs:904-915,1600-1642`). Do not widen `SessionFacts` into a universal document controller; keep the document-session projection separate and keyed by world/session.

**RESHAPE** `RouteDocument` into only a narrow scope gate over supplied document-session facts:

- `ready`: the URL address is the observed active document; mount the route store.
- `activate`: the URL address is in the same world's open set but inactive; request activation and do not mount yet.
- `acquire`: the URL address is not open; show the existing acquisition surface.

Fetching, SDK invocation, and retries stay in the live Takeoffs adapter; the visual gate receives facts plus an activation callback. This reuses the existing visual primitive without making it omniscient.

For the proven two-local-copy case, **KEEP and reuse** the SDK's existing `doc open` lifecycle operation rather than adding a speculative `doc activate` verb. Its API-thread implementation calls `UIApplication.OpenAndActivateDocument` (`Pe.Revit.Sdk/source/Pe.Revit.Bridge/BridgeApplication.cs:367-401`), and the SDK itself records that this same call reactivates an already-open saved document (`BridgeApplication.cs:579-585`). Pe.Host's `/docs/open` is already a thin generated-contract relay and accepts an exact path (`source/pe-tools/apps/host/src/session-route.ts:153-189,322-334`). The live adapter should post the selected open document's full path, not require an MRU match.

After the SDK receipt answers, re-read `revit.context.document-session` (or observe the existing document state-sync) and mount only when `activeDocument` equals the URL address. “Activation requested” and “requested document observed active” are distinct truths. Full-path identity is mandatory for the two same-title project-a copies; never select by title.

Cloud activation without an MRU/region-bearing selector is not proven by this local-copy falsifier. Do not grow a new cross-product abstraction now; leave that case explicitly unsupported until its exact SDK selector evidence exists.

## Order of repair

1. Delete the Host timeout guesses and preserve SDK queue outcomes in receipts.
2. Move carrier binding behind explicit one-binding initialization; remove binding from adoption/materialization writes.
3. Feed Takeoffs the existing open-document projection, gate inactive versus active, and reuse exact-path `doc open` for activation.
4. Mount the document store only after observed active identity matches `?doc=`.

This is the smallest shape that makes both live failures truthful. It adds one concrete Takeoffs initialization operation, deletes guessed timeouts and duplicated busy state, and reuses the existing document inventory, URL, SDK lifecycle verb, Host relay, and route visual primitive.
