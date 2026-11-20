# Product declaration map

Live frontier of the product-declaration run. It answers one question: what does a product declare, in one place, and what do the host, the web, Pea, the Tutorial and the homes derive from it? The specimens are `/rooms`, rebuilt clean-room, and Fans. The rulings are in the ledgers of [routes](LEDGER.md), [rooms](../rooms/LEDGER.md), [homes](../homes/LEDGER.md), [takeoffs](../takeoffs/LEDGER.md) and [ducts](../ducts/LEDGER.md), and in [ADR 0057](../../adr/0057-an-unreadable-model-record-may-be-overwritten.md) and [ADR 0058](../../adr/0058-the-home-ladder.md).

Written 2026-11-20 from the run's agreed plan. Base: main `8d3a507c`. The plan check is pinned to `09943e6c`, and the diff between the two is ledger files only. This file replaced the kernel crusade 2 map, which closed on 2026-11-14. Git holds that map at `8d3a507c:docs/features/routes/MAP.md`, and the routes ledger owes its sweep. Delete this file when S12 and S11 land, after the sweep the `docs` skill describes.

Evidence, all gitignored, kept while this map exists:

```text
.artifacts/runs/product-decl-20261120/RULES.md
.artifacts/runs/product-decl-20261120/PLAN.md
.artifacts/runs/product-decl-20261120/OWNER-QUEUE.md
.artifacts/runs/product-decl-20261120/plan-check/G1.md to G7.md
.artifacts/runs/product-decl-20261120/baseline-09943e6c.md
.artifacts/handoffs/2026-11-19-product-declaration-muse.md
.artifacts/runs/muse-product-20261119/
```

Stamp for the whole plan: UNPROVEN[nothing is built; each slice names its falsifier]. Every `path:line` in a plan-check report is at `09943e6c`, so it is a locator to check again and not a fact. The hours and lines are estimates. The plan-check readers ran no compiler, no suite and no Revit.

## Nouns and invariants

- **Product**: one contract value at `ts/products/<p>/contract/src/product.ts`, found by path. It holds homes, cells, readings, commands, routes and a guide. A product may have no route or several.
- **Home**: where a value rests. A product declares only its own homes. A home that C# writes is declared in C# and referenced through a generated handle. The three homes of ADR 0037 are content homes.
- **Cell**: a schema and a per-subject key. The cell list builds the Work schema. Pea's editable list, the sheet binding homes and the factual part of the description derive from it.
- **Reading**: a handle with its sources and its load fields (`alone`, `freshBy`, `slow`).
- **Command**: an input, its native operations, and one `writes` map from each home to the cells it lands. A home with no cell is in the map with no cells.
- **Route**: address fields, a subject and readings.
- **Binder**: `implement(product, { readings, commands })` on the host and `screen(product.routes.x, { panes, layout, overlay })` on the web.
- **Region record**: the one document record of Rooms, keyed by the Filled Region's `UniqueId`.
- **Door check**: the native refusal of a write to a home the command did not name.
- Invariants:
  - A missing or extra host body or pane is a compile error.
  - The Work schema is built from the cell list. It is never an annotation on an existing schema, because a Zod annotation does not survive `.extend`, `.optional`, `.default` or a union.
  - The contract does not import `@pe/web-kernel`.
  - No cell carries a `lands` line. A cell that no command lands stays in Work.
  - A home value is never a string in a command declaration.
  - An element is keyed by `UniqueId` everywhere (ADR 0035 rule 2). ADR 0028 has the route codec refuse an element id.
  - An unreadable model record does not lock further action (ADR 0057).
  - A new stored fact walks the home ladder (ADR 0058).
  - `/rooms` is rebuilt clean-room. Its writer reads the spec, the native operations and the primitives, and never the old `/rooms` web code.
  - No legacy, no migration of an old stored record, no compatibility shim and no forwarder.
  - The export names of `@pe/mcps/product-actions`, `product-catalog` and `product-contracts`, and of `productExecutors` and `productHttpRoutes`, do not change.
  - A slice that changes C# regenerates `ts/packages/host-contracts` in the same commit and again after each merge.

## Ordered deletable slices

Hours are raw writer-hours multiplied by 0.25, the `estimate_ratio` in `.agents/models.toml`. The box of a slice is twice its hours. Lines are production lines, measured where a report measured them. "Report" names the plan-check file that holds the slice's full file set.

| Slice | Branch | What it settles and deletes | Falsifier | Paths the falsifier observes | Report |
|---|---|---|---|---|---|
| D0 | `pd/d0-docs` | the rulings, two ADRs and this map are tracked | `python .agents/skills/check.py` shows no failure the commit made | `docs/features/`, `docs/adr/`, `.agents/models.toml` | none |
| W0 | `pd/w0-reds` | main's own reds: 2 format files, 162 type-aware lint errors, the host typecheck order in a fresh worktree | `verify` runs past the stage where it stopped on `09943e6c` | the files `baseline-09943e6c.md` names | baseline |
| S0 | `pd/s0-archive` | deletes `/schedules`, `/family` and the `/captures` screen, with their Work commands. 7,326 route lines and 560 grid lines leave | the route census shows them gone, no archived door stays advertised, and the suite is green | `ts/packages/agent-contracts/src/routes/table.generated.ts`, `ts/packages/agent-contracts/src/generated/route-directory.ts`, `ts/packages/agent-contracts/src/semantic-actions.ts`, `ts/packages/agent-contracts/src/schedule-actions.ts`, `ts/packages/agent-contracts/src/family-actions.ts` | G1 |
| S1 | `pd/s1-helpers` | the seven route helpers export from `@pe/agent-contracts`, with no forwarder. All 82 importer files are rewritten | a contract module imports the helpers with no web package installed | `ts/packages/web-kernel/src/route/host-read.ts` and the six other helper files, the new subpath of `@pe/agent-contracts` | G1 |
| S2a | `pd/s2a-binders` | `product()`, `implement()` and `screen()`, one new generator path for a folder that has `contract/src/product.ts`, and the fixture product rewritten | a missing host body fails `tsc` in a file of `@ts-expect-error` lines, for a reading and for a command. The one-folder fixture still adds a command with no edit outside its folder | the kernel `product.ts` and `product.types.test.ts` in S1's package, `ts/packages/web-kernel/src/route/screen.ts`, `ts/apps/web/scripts/product-assembly.ts`, `ts/tests/repo-guards/src/product-assembly.guard.test.ts` | G2 |
| S2b | `pd/s2b-grammar` | cells, homes, the home constructors with their cost answers, the `writes` map, and a typed Rooms `product.ts` | a cell Pea may edit that the schema lacks fails `tsc` on the typed Rooms `product.ts`. A home whose key kind the cell lacks fails `tsc` | `ts/products/rooms/contract/src/product.ts`, the kernel `product.ts` | G2 |
| S4a | `pd/s4a-ducts-base` | the ducts base on the declaration, the shared sheet dispatch, and the generator cutover. Deletes the 13 `pe` pointer kinds and the `pe` path of the generator. One writer | no `pe` pointer key remains in any `package.json`, and the generator has one mode | `ts/products/ducts/host/src/action-runtime.ts`, `ts/apps/web/scripts/product-assembly.ts`, the six product `package.json` files | G3 |
| S3 | `pd/s3-fans` | Fans on the declaration, with a bounded overview read | the `esp` drift between `fansTool.work.editable` and the Work schema is a compile error. The fixed Fans journeys stay green. The "All" overview stays under the read ceiling of 512 | `ts/products/fans/contract/src/fans.ts`, `ts/products/fans/contract/src/semantic-actions.ts`, `ts/products/fans/host/src/host.ts`, `ts/products/fans/web/src/calc.ts` | G2, G4 |
| S4b | `pd/s4b-ductsys` | the Duct Systems route on the declaration, with a bounded overview read | the systems overview no longer builds every row's detail. Its journeys stay green | `ts/products/duct-systems/host/src/host.ts`, `ts/products/ducts/contract/src/system-work.ts`, `ts/products/duct-systems/web/src/design-calc.ts` | G3, G4 |
| S5 | `pd/s5-homes` | the homes table, platform and product, rendered from the home constructors. The Tutorial shows the home each cell lands in and the homes each command writes | the Tutorial text for Fans names every home in the homes split that Fans owns. The project home shows as declared and not reachable | the home constructors of S2b, the Tutorial projection | G2 |
| S6 | `pd/s6-loading` | the reading load fields, host reuse of a fresh completed read, newest request wins before dispatch, one line for what holds the queue | a slow image no longer holds the roster. A superseded request never dispatches | `ts/apps/web/src/shell/typed-mount.ts` (`syncReads`, `readiness`), `ts/packages/web-kernel/src/route/typed-route.ts` (`visibleReads`), `ts/apps/host/tests/native-read-sharing.test.ts`, `ts/apps/host/tests/host-read-graph.test.ts` | G4 |
| S7 | `pd/s7-picture2d` | the 2D plan mode of the picture slot | a plan with a raster, polygon marks and a hit test renders from a declaration. A browser drive checks a rotated registration, a polygon with a hole, and a pick after pan and zoom | the picture slot declaration and its web pane, the new plan renderer | G5 |
| S8a | `pd/s8a-rooms-rec` | Rooms natives: the eleven carriers on Detail Items become the region record, `rooms.write` answers per cell, and a trace is recovered after a commit. The record shape is not fixed until M1 reports | fresh-rung tests for each change: the region record written and read back, a per-cell receipt from committed readback, no receipt on rollback, and a trace found after a failed publish | `dotnet/Pe.Revit.Takeoff/TakeoffCarriers.cs`, `dotnet/Pe.Revit.Takeoff/Rooms.cs`, `dotnet/Pe.Revit.Takeoff/RoomsRunTraces.cs`, `dotnet/Pe.Shared.RevitData/Takeoffs/TakeoffContracts.cs`, `ts/apps/host/src/takeoff-actions.ts` | G6 |
| S8b | `pd/s8b-ducts-key` | Ducts natives: `DuctLossStore` keyed by `UniqueId` with a version bump, and the one shared backup-and-notice overwrite of ADR 0057 | a fresh-rung test seeds unreadable bytes, writes, finds the bytes on disk, counts one notice and reads the new record back. A numeric key does not decode as a new key | `dotnet/Pe.Shared.RevitData/Serialization/OwnerBlob.cs`, `dotnet/Pe.Revit/Parameters/OwnerBlobStore.cs`, `dotnet/Pe.Shared.RevitData/Ducts/DuctApply.cs`, `dotnet/Pe.Revit.Global/Lib/Mep/DuctApplier.cs` | G6 |
| S9 with S10 | `pd/s9-rooms` | `/rooms` rebuilt clean-room, then `/takeoffs` as the second route of the same product. One writer, two acceptance checkpoints. 3,351 production lines of the old `/rooms` leave | checkpoint 1: the rooms-fixes tests pass against the new folder, and `/rooms` is driven on a real model. Checkpoint 2: both routes share one `product.ts`, and the Takeoffs journeys are green | `ts/products/rooms/`, `ts/apps/web/src/rooms/` (deleted), `dotnet/Pe.Revit.Takeoff/TakeoffAtlas.cs` (plan by name ends) | G7 |
| S11 | `pd/s11-door` | the door check at `OwnerBlobStore.Write`, with the allowance carried from the registered command | a fresh-rung test refuses a write to an unnamed home, leaves its bytes and binding unchanged, and lands the same write when the home is named. A host test proves the allowance is forwarded | `dotnet/Pe.Revit/Parameters/OwnerBlobStore.cs`, `dotnet/Pe.Revit.Global/Services/Host/OpRunner.cs`, `ts/packages/host-internal/src/dispatch.ts`, `dotnet/Pe.Revit.Tests/Proofs/OpScopeProofTests.cs` | G5 |
| S12 | `pd/s12-tail` | the drive and integration tail | one full pass of the journeys on the final candidate, one suite, and every row stamped or ruled Owed | the journey pack and the final tip | none |

S11 covers owner records only. A parameter write, an entity write and a trace file write each need their own coverage if they are declared as homes. That census runs after S8.

Measure M1 is the driver's first drive: the bytes of the region record on copies of the Chadds and Snowdon models, against the 256 KiB cap. It uses one Revit, admitted through `python .agents/skills/slot.execute/machine.py admit revit-drive`, with add-ins off. If the record does not fit, the geometry hash stays in the model and the solver's original room goes to the trace file.

```text
Estimate: pd/d0-docs        0.3h   +0L    0   (docs only)
Estimate: pd/w0-reds        0.8h   0L     0   (2 fmt files, 162 type-aware lint errors, fresh-worktree host tsc order; then verify again past the stage it stopped at. baseline-09943e6c.md)
Estimate: pd/s0-archive     1.3h  -7900L  -   (7,326 route + 560 grid, G1)
Estimate: pd/s1-helpers     0.6h   0L     0
Estimate: pd/s2a-binders    0.9h  +200L   +
Estimate: pd/s2b-grammar    1.3h  +300L   +
Estimate: pd/s4a-ducts-base 1.0h  -300L   -
Estimate: pd/s3-fans        1.6h  -400L   -
Estimate: pd/s4b-ductsys    1.0h  -300L   -
Estimate: pd/s5-homes       1.0h  +150L   +
Estimate: pd/s6-loading     2.4h  +260L   +
Estimate: pd/s7-picture2d   2.0h  +180L   +
Estimate: pd/s8a-rooms-rec  1.9h  +150L   +
Estimate: pd/s8b-ducts-key  1.0h  +120L   +
Estimate: pd/s9-rooms       5.0h  -1500L  -   (3,351 out, about 1,850 in; the addition is a guess)
Estimate: pd/s11-door       1.4h  +100L   +
Estimate: pd/s12-tail       2.0h   0L     0
```

The raw total is about 98 hours, so about 25 active writer-hours. The net is about 9,000 production lines deleted, by the readers' figures. S0 alone deletes 7,900, so the rest of the run nets near zero. A slice that grows past twice its lines is stopped and planned again.

### Waves and gates

```text
Wave: A pd/d0-docs pd/w0-reds pd/s0-archive pd/s1-helpers
Wave-Status: A ACTIVE
Wave: 1 pd/s6-loading pd/s7-picture2d pd/s8a-rooms-rec pd/s8b-ducts-key
Wave-Status: 1 ACTIVE
Wave: B pd/s2a-binders pd/s2b-grammar
Wave: C pd/s4a-ducts-base pd/s3-fans pd/s4b-ductsys pd/s5-homes
Wave: 2 pd/s9-rooms
Wave: T pd/s12-tail pd/s11-door
```

- Wave A is tasks the root briefs. It started at the plan's agreement.
- Wave 1 is the run's first wave, under implementor 1. It started at the plan's agreement. S8a writes code and does not fix the record shape until M1 reports.
- Wave B is tasks. S2a starts after S1 merges. S2b starts after S2a. S2 lands after S0, because S0 regenerates the route table.
- Wave C is tasks. S4a starts after S2b. Then S3, S4b and S5 run at once.
- Wave 2 is the run's second wave, under implementor 2. S9 with S10 starts after S2b merges, beside wave C.
- Wave T: S12 runs on candidates. S11 is a task after the run's end gate.
- The critical path is S1, S2a, S2b, S9 with S10, S12: about 13 wall hours with four landings.
- Land gates from G6: the shared recovery of S8b and ADR 0057 merge before the Rooms cutover of S8a. Generated host contracts are regenerated once on the integrated tip.
- One Revit session runs at a time on this machine, so the fresh-rung tests of S8 and the drives of M1, S9 and S12 queue.

### What the plan check changed

- S2 is two slices, because the binders reach the first falsifier alone and the grammar needed the owner's ruling on `lands` (G2).
- The generator is reduced in S4a and not in S2, because Fans, Duct Systems and the ducts base keep their `pe` keys until they convert (G2).
- S2 does not edit `ts/apps/web/src/shell/typed-mount.ts`. `screen()` returns today's `TypedRoute` from a new file (G2).
- S4 is two slices, because `ts/products/ducts/host/src/action-runtime.ts` dispatches by Work route for both products (G3).
- The overview reads moved from S6 to S3 and S4b, because a load field cannot shrink 672 recipes or a 47 MiB value (G4).
- S8 is two slices, Rooms and Ducts (G6).
- S9 and S10 are one writer, because they share the declaration, the host body and the plan identity (G7).
- S1 writes no forwarder. G1 had proposed forwarders, and `AGENTS.md` forbids shims.

### Shared contracts

Each contract is copied word for word from the plan-check report that the plan cites, and each brief quotes it. The readers marked them as proposals. A writer who must change one changes it here first.

Reading load, for S2, S6 and S9. From `plan-check/G4.md:55` and `:56`:

> - **Paste into S2/S6/S9 briefs, proposed first version.** `type ReadingLoad = Readonly<{ alone?: true; freshBy?: readonly ["document-mark"]; slow?: string }>;` The read contract carries `load?: ReadingLoad`, with absent meaning today's behavior. Each `alone` reading publishes/errs independently and does not gate the roster/core or its Work. Keep full demanded-read settlement for callers explicitly waiting for all readings. `freshBy` is an opt-in host policy. For the first Rooms use, the cache key includes definition, normalized args (including view and export options), and exact target opening. The current document-mark revision must equal the captured one, and any other consumed source that can affect the value must still match. Document mark is the conservative first candidate for graphics, subject to a freshness check, and must not license reuse for graphics changes it cannot observe. No TTL guess. `slow` is a user-facing label, e.g. `"Exporting plan image"`, not a bypass or another timeout. If the proof cannot establish the graphics basis, leave image reuse disabled until there is a trustworthy signal. Numeric plan ids in the current route are not a new S9 contract. Use the settled S9 identity direction and resolve to the native id at the boundary.
> - **Host/wire agreement.** `type ReadingDemand = Readonly<{ current(): boolean }>;` is host-only, one predicate per live join and disjunction across shared jobs. At the dispatcher claim, check it within the same synchronous transition as the send reservation, without a network lookup. Existing native cancellation/reconciliation still governs a job already dispatched. Proposed stream payload `type QueueHolder = Readonly<{ requestId: string; operationKey: string; label: string }> | null;` is scoped to the requesting subscription's resolved session, delivery generation fenced, and displayed once for the route while it is waiting. A status-only delivery must have distinct wire identity without advancing freshness or rerunning the Value.

2D plan picture, for S2, S7 and S9. From `plan-check/G5.md:53`:

```ts
type XY = readonly [number, number];
type PlanRaster = {
  readonly href: string;
  readonly registration: {
    readonly width: number;
    readonly height: number;
    readonly topLeft: XY;
    readonly topRight: XY;
    readonly bottomLeft: XY;
  };
};
type PlanPicture = {
  readonly raster: PlanRaster | null;
  readonly polygons: readonly {
    readonly subject: SubjectRefCode;
    readonly rings: readonly (readonly XY[])[];
    readonly ink?: string;
  }[];
};
type PlanPictureSlot<C> = { readonly mode: "plan"; plan(ctx: C): PlanPicture };
// PictureSlot<C> = ModelPictureSlot<C> | PlanPictureSlot<C>
// Keep the existing model case as the default and project the plan mode explicitly.
```

Command writes allowlist, for S2 and S11. From `plan-check/G5.md:117`, updated by the owner's `lands` ruling:

```ts
type OwnerBlobHomeKey = `owner-blob:${string}`; // canonical lowercase Guid D
type GeneratedOwnerBlobHome = { readonly key: OwnerBlobHomeKey };
// HomeHandle is the S2 union; GeneratedOwnerBlobHome is its native blob branch.
type CommandWriteContract = { readonly writes: { readonly [home in keyof Homes]?: readonly CellName[] } }; // the allowlist is the keys; a cell lands in at most one home across all commands
type NativeCommandAllowance = {
  readonly derivedCommand: string;
  readonly allowedHomeKeys: readonly string[];
};
```

From `plan-check/G5.md:132`:

```csharp
// Document home, on Project Information via OwnerBlobStore.
OwnerBlobStore.Write(document, RegionRecord.Owner, regionRecord.ToData());
// Proposed payload contract. Envelope is { owner, version, data }.
// data.byUniqueId: map from FilledRegion.UniqueId to
// { role, provenance, fields }
// fields: { name, type, ceilingFt, people, lightingW,
//           equipSensible, equipLatent, ventilationCfm }
```

The two reports also name the region map differently: `data.byUniqueId` in G5 and `data.regions` in G6. S8a owns the record, so G6's name stands unless S8a changes it here.

Region record, per-cell receipt, backup and notice, for S8a, S8b, S9 and S11. From `plan-check/G6.md:32`:

```text
{owner, version, data:{regions:{[UniqueId]:{
  role: "zoning-region" | "room-region" | "held-residue",
  fields:{name,type,ceilingFt,people,lightingW,equipSensible,equipLatent,ventilationCfm},
  provenance:{zone:UniqueId|null,runId,sourceRoomId,sourceSqft,
              partition?,measurement?,r10?,geometryHash?,wallHash?,flags,mergedFrom?:UniqueId[],
              view?,name?,systemTag?,...ownerExtensionData}
}}}}
RoomField = name | type | ceilingFt | people | lightingW | equipSensible | equipLatent | ventilationCfm | role
RoomsWriteReceipt = {cells:[{uniqueId: string, field: RoomField, value: string|number|null}]}
DuctElementMap<T> = Record<UniqueId,T>
DuctStoreDeletes = {instances?:UniqueId[],terminals?:UniqueId[],terminalFlows?:UniqueId[],
                    equipmentFlows?:UniqueId[],roles?:UniqueId[],verdicts?:string[]}
ReplacementEvidence = {documentIdentity,owner,versionOrDecodeReason,rawUtf8Sha256,localBackupRef}
```

The C# write set of S8a and S8b. From `plan-check/G6.md:62`:

```text
dotnet/Pe.Revit.Takeoff/TakeoffCarriers.cs
dotnet/Pe.Revit.Takeoff/Rooms.cs
dotnet/Pe.Revit.Takeoff/RoomsRunTraces.cs
dotnet/Pe.Revit.Takeoff/ZoneMaterializer.cs
dotnet/Pe.Revit.Takeoff/TakeoffAtlas.cs
dotnet/Pe.Revit.Takeoff/RegionMeasurements.cs
dotnet/Pe.Revit.Takeoff/SystemRegistry.cs
dotnet/Pe.Shared.RevitData/Takeoffs/TakeoffContracts.cs
dotnet/Pe.Revit.Global/Services/Host/RevitDataRequestService.cs
dotnet/Pe.Shared.RevitData/Serialization/OwnerBlob.cs
dotnet/Pe.Revit/Parameters/OwnerBlobStore.cs
dotnet/Pe.Shared.RevitData/Ducts/DuctApply.cs
dotnet/Pe.Shared.RevitData/Ducts/DuctContracts.cs
dotnet/Pe.Revit.Global/Lib/Mep/DuctApplier.cs
dotnet/Pe.App/Services/AutoTag/AutoTagService.cs
dotnet/Pe.Revit.Partition/Declaration.cs
```

The TypeScript cutover paths and generated outputs of S8a and S8b. From `plan-check/G6.md:85`:

```text
ts/apps/host/src/takeoff-actions.ts
ts/packages/agent-contracts/src/rooms.ts
ts/packages/agent-contracts/src/semantic-actions.ts
ts/packages/mcps/src/shared/takeoff-ops.ts
ts/products/ducts/domain/src/calc/inputs.ts
ts/products/ducts/domain/src/rulings.ts
ts/products/ducts/domain/src/staged.ts
ts/products/ducts/domain/src/unit-roles.ts
ts/products/ducts/domain/src/write-evidence.ts
ts/products/fans/domain/src/calc/write-request.ts
ts/products/fans/host/src/actions.ts
ts/products/duct-systems/contract/src/ducts.ts
ts/packages/host-contracts/src/generated/host-catalog.generated.ts
ts/packages/host-contracts/src/generated/host-ops.generated.ts
ts/packages/host-contracts/src/generated/native-effect.generated.ts
ts/packages/host-contracts/src/generated/ops-catalog.sha
```

S1 package: the seven helpers export from `@pe/agent-contracts`. The first commit of the S1 writer fixes the exact subpath, and it is copied into the brief of S2.

### Deliberately unbuilt

- Pods and Pages (ruling 12). One fact for a later effort: `pod.json` has two parsers and no schema, and the Page event log has no version.
- The project-home round. The homes ledger owes it.
- A bound-parameter home constructor, until a product needs one (ADR 0058).
- Coverage of the door check for parameter, entity and trace writes, until the census after S8 says which of them are homes.
- A token for Stop inside the Prepare and Capture phases of partition. Partition already has cooperative Stop and progress (G6).

## Deletion criteria

- A slice merges when its writer's typecheck and touched tests pass. Its falsifier is a row stamped on a merged tip.
- A slice is done when everything its row says it deletes is gone.
- No slice writes migration code, a compatibility shim or a forwarder. A compile break is the census.
- A generated file is regenerated after a merge and never merged by hand.
- The effort ends when no `pe` pointer key remains in any `package.json`, the generator has one mode, the old `ts/apps/web/src/rooms/` folder and the eleven carriers on Detail Items are gone, the door check refuses in a fresh-rung test, and every proof row is stamped on the final tip or ruled Owed by the owner.
- Branch `spike/muse-product-decl` (`f7e68a81`) is deleted when S2a starts.

## Risk tier per surface

| Surface | Tier | Why |
|---|---|---|
| The unreadable-record overwrite (S8b) | integrity | it replaces bytes in a person's model, and the kept copy is the only other one |
| The region record and the duct re-key (S8a, S8b) | integrity | stored shapes change, and old records become unreadable on purpose |
| The door check (S11) | integrity | it decides which home a command may write |
| The archive (S0) | contract | it removes commands that Pea can call, so no door may stay advertised |
| The kernel, the grammar and the conversions (S1 to S4b) | contract | generated lists and types cross the host, the web and Pea |
| Reading load and the queue holder (S6) | contract | it changes when a read is reused and which request reaches Revit |
| The per-cell receipt of `rooms.write` (S8a, S9) | contract | a wrong receipt retires an edit that did not land |
| The homes table and the Tutorial text (S5) | presentation | derived text with no data path |
| The 2D plan picture (S7) and the Rooms and Takeoffs screens (S9 with S10) | presentation | drawing and layout. The host bodies in S9 are contract tier |

## Decision log

- 2026-11-19, kaitpw, rulings 1 and 2: "i hate C, json isnt strong enough. d i doint like bc it brings backend stuff into web code, bleh. A + B seems the way to go".
- 2026-11-19, kaitpw, rulings 3 to 13: "agreed on all. family is mostly stable but i haent driven it substantially in a long time so its not worth the time. the last i remember we had lots of freshness/reactivity bugs".
- 2026-11-20, kaitpw, ruling 14: "100% yes to turning the carriers into doc record."
- 2026-11-20, kaitpw, ruling 15: "yes to placement. prove is kinda weird but not sure where would be better".
- 2026-11-20, kaitpw, in the launch message: "Delegation stance is mostly sol 6.2, ignore the empty meter we have usage credits. fable low and sometimes medium where judgement counts. dont use partners/leads more than you need. however I would also like a fresh fable smeller after lots of code is written or lots of time has passed. they should always ask, firs principles, if there is a simpler or safer way to do things and steer direction away from smells, even if it costs some scope growth."
- 2026-11-20, kaitpw, at plan agreement, on the stance table and the charter differences: "Agreed, launch". Restated: the `sol` model of `.agents/models.toml` runs most writers, the integrator and the driver. The `fable` model runs S2 at medium effort and the Rooms rebuild at low effort. The `opus` model runs only the root and one implementor per Rooms wave. S0 and S1 start beside the wave-zero red fixes. The root briefs the task slices S0 to S5 directly.
- 2026-11-20, kaitpw, at plan agreement, on moves of main: "Every green tip". Restated: the integrator fast-forwards main to every integration tip whose full suite is green, all night, and the tips of the Rooms run are included. The root's default had held the Rooms tips to the end.
- 2026-11-20, kaitpw, at plan agreement, on the smeller and the purger: "maybe as one?". This is a question and not a ruling. The default the run takes, which can be reopened: one role, the purger charter, run as a fresh thread per pass with no earlier context, after every 1,500 merged production lines or 3 wall hours, and once on the final tip. It asks from first principles whether a simpler or safer way exists.
- 2026-11-20, kaitpw, on `lands`: "great, i like ur rec on lands. continue without me". Restated: placement is declared on the command and not on the cell. Each command carries one `writes` map from each home to the cells it lands. A cell that no command lands stays in Work. No cell carries a `lands` line. The recommendation the owner names is in `plan-check/G2.md`, under "The rule I would write".
- 2026-11-20, the root's default, which can be reopened: the pointer for agents to the home ladder is one line in `ts/AGENTS.md`. The owner left the choice between that file and the `prove` skill open.
