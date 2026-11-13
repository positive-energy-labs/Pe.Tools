# Kernel crusade 2: shared contracts

Each contract below is one that two writers code against. A writer's brief copies the ones it names, and a change to one changes here first, then in every brief that names it. Written from the four plan-check readers at ee2d30fd (their full results are in `.artifacts/runs/kernel2-20261112/plancheck/`). Delete this file with the map.

Paths: `C/` is `ts/packages/agent-contracts/src/`, `W/` is `ts/apps/web/src/`, `H/` is `ts/apps/host/src/`.

## Store and Timeline (reader A)

**K-A1. Store, day one (ST1).** No exported signature in `store.ts` changes. `readStored` returns `{ kind: "kept", reason }` for any file it could not read, in either class. A `discard` removes the file only after `restBlob` returned; if the copy fails the result is `kept` and one notice posts. `readDerived` never deletes: a name that does not match its bytes is skipped with one notice.

**K-A2. Kinds (ST4a), as built on k2/store.** Home `ts/packages/host-contracts/src/kinds.ts`, imported as `@pe/host-contracts/kinds`. `Kind<T, At, Args>` with `at: "home" | "state" | "state-kept"`; `Kind.in(root, ...args)` is the only way to a `StoredFile<T, At>`; `read(file)`, `writeHome(file, bytes, expectSha256): HomeWrite`, `writeState(file, bytes)`. `Stored<T>` is `ok | missing | kept | set-aside`, and `set-aside` carries `blob: StatePath`. No function in `kinds.ts` takes or returns a bare `string` path. What the plan text did not have, each found while building it:

- A kind is declared with `stateKind`, `keptStateKind` or `homeKind({ place, schema, segments, parse?, quiet? })`. A segment that is not one name (`..`, a separator, empty) throws at `in`.
- A state kind's root is `StateRoot`, minted only by `stateTree(root)` in `service-identity.ts`; the host's is `hostState()` in `H/host-ownership.ts`. `stateTree` is the one table of machine-state paths, and its rows are `StatePath`.
- A home kind's root is `HomeRoot`, a proven `Home` bound to this machine: `stateTree(root).home(home)`. The binding is where `writeHome` gets the blob root and a kept read gets the notice file, so no caller passes either.
- A state file an owner refuses after decoding, and a person's clear: `setAside(file, reason)`, the one set-aside door, bytes kept and one notice. A clear has no door of its own and no undo hook (kaitpw, 2026-11-13: "whatever is occam ... set aside is fine with me, i dont think i care about it being undo-able tho").
- Append logs: `stateLog({ place, schema, segments })`, then `readLines(log)` and `appendLine(log, value)`.
- Derived folders: `derivedIn(homeRoot | stateRoot)`, then `readDerivedIn`, `writeDerivedIn`, `refuseDerived`. A refused derived file in a home is kept with a notice; in machine state it is set aside.
- Notices and blobs: `notices(machine)`, `note(machine, notice)`, `rest(machine, bytes)`, `rested(machine, sha256)`. `rest` is the one blob writer.
- `store.ts` keeps the functions that take bare paths until the store sweeps (ST4b to d) move their callers; a sweep deletes each export when its last outside caller goes. `kinds.ts` holds no filesystem write, so `OWNERS.fsWrites` still names `store.ts` alone.
- Kernel rules every kind inherits (K-A1 plus two): no write lands over a state file that was kept until its bytes rest in the blob store, and a passing lock on a read is waited out.

**K-A3. Timeline (C1), from chrome.md 3.1.** Home `agent-contracts/src/work-timeline.ts`. `StepRef = { work: WorkKey; revision: number; label: string } | { home: string; sha256: string; label: string }`. `WorkTimeline = { rows; undo: StepRef | null; redo: StepRef | null; refusal: { undo: string | null; redo: string | null } }`. `WorkTimelineArgs = { works: readonly WorkKey[] }`. `WorkStepRequest = { direction: "undo" | "redo"; works: readonly WorkKey[]; expected: StepRef }`. The host refuses when `expected` is not the step it would take. Rows are in host order; the browser never sorts by `at`. `by` is `"human" | "pea"`.

**K-A4. Findings Work as a member.** The five lines in section 1.

**K-A5. Home-write row (ST7a against C2), from storage.md C3.** `HomeWriteRow = { kind: "home-write"; place; path; sha256; priorSha256: string | null; by: Caller; at: string; owner; tier: "user" | "project" | "firm"; home }`. `HomeWriteSource = { rows(filter: { owner: string; homes: readonly string[] }): HomeWriteRow[]; step(ref: { home: string; sha256: string }, by: Caller): HomeWrite }`, declared in `apps/host/src/tiered-settings.ts`. The Timeline arm is `HomeWriteRow & { undoable: boolean }`. C2 leaves one registration point for a second source; ST7a registers it.

**K-A6. Places (C9 against ST4a).** `placesKind: Kind<PlacesFile, "state", []>` at `state\places.json`, declared in `apps/host/src/places.ts` with `stateKind` from `@pe/host-contracts/kinds`, minted by `placesKind.in(hostState())`, written only by `writeState`. Focus stays per window in `sessionStorage` (`pe.place.focus`).

The five lines K-A4 names (findings Work as a Timeline member):

1. The findings Work key is `bindWork(FINDINGS_OWNER, address, undefined, open)`; the host adds it to `works` and the browser never sends it.
2. Every findings door writes only through `workspace.write(..., { kind: "apply", press, label, expectedRevision, patches })`.
3. `press` is unique per write. Today it is `finding:<id>` (`H/slots/findings.ts:43`), which would repeat on rule or retract.
4. A finding's `person` maps to the journal's `human` at the write.
5. Both the `work` Reading and `work.timeline` invalidate on the one `workspace.subscribeUncaptured` event (`H/reads/invalidations.ts:54`).

`ts/packages/runtime/src/work-journal.ts` stays as the host Timeline's engine. No file under `W/` imports it when slice 8 lands; the purger's guard holds that.

## Native effects and evidence (reader B)

The cited lines are in `.artifacts/runs/mega-review-20261112/crusade/plan/`. The freeze-native writer turns 2, 3, 4 and 8 into code, and that code is then the contract.

Copy each into both briefs verbatim from the cited lines.

1. **Scopes** (writer B gives; SI-S3 and PI-P1 take). `sight.md:49-58`. No scope parameter means Read. Signature order: request, document, scope, cancellation token. Space ops take no scope.
2. **`Touched`** (writer B C# and writer E TS). `sight.md:63-75`. Filled by the scope and the monitor, never by an op. `restoreFailed`, `unauthorized` and `unknown` raise one notice at the terminal write.
3. **Receipt response shape** (writer B and writer E). New, from finding 2, and not yet written anywhere: the object `BridgeAgent` writes to the response file and `native-receipts.ts` reads. It must carry the payload, `touched` and the evidence. The lead writes it in phase 0.
4. **Evidence interfaces** (writer B lift; writer C implements). `sight.md:98-104`. `IObserved { DocumentKey; Revision? }` and `IEvidenced<out TEvidence>`. A null revision stays unknown.
5. **`SpatialEvidence` wire shape** (writer C gives; the TS decode writer takes). `picture.md:96-108`.

   Native PI-P1 implements `IEvidenced<SpatialEvidence>` on Space query answers and PSC1 metadata. `SceneArtifact` implements `IEvidenced<SceneEvidence>`: fixed source/acquisition/coverage counts plus the content-addressed PSC1 reference, never full membership in either RPC evidence projection. The answer member is `evidence`; `stamp` and `fresh` are removed. PSC1 metadata retains full `SpatialEvidence` and format `space-scene-v6`. `SceneReceipt` keeps counts and observation `revision`/`observedAt`. The C# authority is `dotnet/Pe.Revit.Space/Coverage.cs`.

   D11: `SceneEvidence` carries `documentKey`, nullable `revision`, `observedAt`, `frame`, `summary` and `artifact: { id, url, bytes }`. Summary has `acquisitionRequested`, `representation`, and fixed count records for source availability, acquisition outcomes and coverage reasons. It carries no identity lists, transforms, reach boxes or exclusions. `SceneArtifact.id/url/bytes` derive from that same reference. Full detail is obtained from the artifact, so the runner's separate `EvidenceJson` cannot repeat the element lists.

   ```ts
   type Placement = { hostDocumentKey: string; linkUniqueId: string | null };
   type SubjectExclusion = { documentKey: string; placement: Placement; subjectUniqueId: string };
   type SourceRevision = { kind: 'observed' | 'unavailable'; epoch: number | null;
     version: string | null; reason: 'not-recorded' | 'source-unread' | null };
   type SourceObservation = { placement: Placement; documentKey: string | null;
     revision: SourceRevision; toHost: readonly number[]; availability: 'loaded' | 'unloaded' | 'unavailable' };
   type Acquisition = { placement: Placement; subjectUniqueId: string;
     outcome: 'acquired' | 'empty' | 'partial' | 'failed' | 'deferred' | 'approximate' | 'outside-scope';
     reason: 'none' | 'geometry-read' | 'triangulate' | 'budget' | 'unsupported' };
   type CoverageGap = { placement: Placement; subjectUniqueId: string | null;
     reason: 'source-unread' | 'partial-geometry' | 'failed-geometry' | 'deferred' | 'approximate'; count: number };
   type SpatialEvidence = { documentKey: string; revision: number | null; observedAt: string;
     frame: 'host-internal-ft'; resolved: Resolved; sources: readonly SourceObservation[];
     acquisition: readonly Acquisition[]; coverage: readonly CoverageGap[]; geometryCost?: GeometryCost | null };
   // Resolved keeps sources/categories/kinds/layers, replaces excludedElementIds with exclusions: SubjectExclusion[],
   // and adds scope: Aabb|null, reach: number[][]|null (eight host-frame XYZ corners per box),
   // representation: string, acquisitionRequested: boolean. Inventory/status sets acquisitionRequested=false.
   // SweepSegment keeps index/verdict/nearest/closestPoint; minGapFt is nullable. Adds surfaceObservation:
   // 'observed'|'none-observed', clearanceReason:'containment-unsupported'. Verdict is HIT|NEAR|UNKNOWN.
   ```

   Geometry packs use schema 2 and retain acquisition with triangles. Old packs recapture. Approximate scene primitives remain drawable and disclose an `approximate` gap; they cannot certify exact collision coverage. Full placement membership, including unread sources, is authoritative. Generation is owned by Kernel, decode by `k2/evidence-decode`.
6. **`NativeAnswer`** (writer D edits; K3 and writer E consume). `picture.md:124-131`, corrected: it replaces the existing `F` parameter at `request-contracts.d.ts:68`.
7. **`ReadOwnership`** (writer D gives; K3 and writer E call). `picture.md:141-159`. Writer E calls `open` at admission, `requestStop` from Stop, `settle` before the parent settles.
8. **`ScriptCaller`** (writer A, both halves). `enum ScriptCaller { Agent, Person }`; `ExecuteRevitScriptRequest` gains a trailing `ScriptCaller Caller = ScriptCaller.Agent`; the host sets `caller: guards(caller) ? "Agent" : "Person"` over anything the input carried; a succeeded receipt whose result has `held` yields one `waits` row with verb `held`.
9. **Capture policy** (writer D, then SI-S3). `sight.md:110`. `native-output.ts` tests `capture: true` from `call-policy.ts` and passes the call's own key to both schemas. SI-S3 adds the focus key as one policy row.

**SI-S3 seeing disclosure (k2/lens).** Capture, lens and show-elements return `lens: {basis, viewId}` and `hidden: {what, count, why}[]`. The only kinds are Links, ScopeBoxes, Levels, Grids, ReferencePlanes, Spaces, Zones, Rooms and Areas. Counts are host-document instances in a category whose visibility switch is off, including unloaded link instances, never linked-document element counts or visible/occluded counts. Filters, phases, worksets and individual hiding are not evaluated. The lens op reports PeDefault basis and reason because it sets those switches. A referenced view reports UserView basis and NotEvaluated reason because the reader does not infer who set its switches. No LensUse exists. Show-elements preserves its target visibility evidence as `hiddenElementIds`.

### Frozen in code (k2/freeze-native)

Contracts 2, 3, 4, 7 and 8 are now code, and the code is the contract. No consumer exists yet: nothing fills or reads these.

| Contract | C# | TS |
|---|---|---|
| 2 `Touched`, `ViewRef` | `dotnet/Pe.Shared.HostContracts/Bridge/Touched.cs` | `touchedSchema`, `viewRefSchema` in `C/action-receipts.ts` |
| 3 receipt response | `OpReceiptResponse` in the same file | `nativeReceiptResponseSchema` in `C/action-receipts.ts` |
| 4 evidence | `IObserved`, `IEvidenced<out TEvidence>` in `dotnet/Pe.Shared.RevitData/Evidence.cs` | `observedSchema` in `C/action-receipts.ts` |
| 7 read ownership | none | `H/reads/read-ownership.ts` |
| 8 `ScriptCaller` | `dotnet/Pe.Shared.HostContracts/Scripting/ScriptContracts.cs`, with `ExecuteRevitScriptRequest.Caller` | generated `scripting.execute` request |

**Evidence lives in `Pe.Shared.RevitData`, not `Pe.Shared.HostContracts`** as `sight.md` C8 said. The op runner references RevitData directly and `Pe.Revit.Space` reaches it through `Pe.Revit`. Space does not reference HostContracts, and it should not take the bridge protocol to state what it observed.

**Receipt response shape (contract 3).** The one object `BridgeAgent` writes to an op receipt's response file. `pe-revit op result` returns it as `response`, and `H/native-receipts.ts` reads it after a lost socket. It replaces the bare payload on success and the bare `{error, statusCode, outcome}` on failure. `OpReceiptResponse.ToJson()` is the only writer of the bytes.

```ts
type NativeReceiptResponse =
  | { payload: unknown; touched: Touched; evidence?: Observed }                      // verdict ok
  | { error: string; statusCode: number; outcome?: string; touched: Touched };       // failed, cancelled, refused
type Observed = { documentKey: string; revision?: number } & Record<string, unknown>; // the domain's own members ride beside
```

- A success has `payload` and no `error`. A failure has `error` and no `payload`. A response without `touched` does not parse.
- A failure carries `touched` because a failed or cancelled call may still have written (`unauthorized`, `unknown`).
- `evidence` is the response's `IEvidenced<T>.Evidence`. It is absent when the response type declares none. An absent `revision` is unknown, never 0.
- The verdict stays on the SDK receipt and is not repeated in the file.
- Both languages assert `ts/packages/agent-contracts/tests/fixtures/receipt-response.fixture.json`: C# that it writes those bytes, TS that it parses them with nothing dropped.

**The live path carries the same facts.** `BridgeResponse` gains `EvidenceJson` and `Touched`, and `BridgeTerminal` gains `Touched` (the restore outcome of a call that finished after its socket was lost). In `ts/packages/host-contracts/src/contracts/bridge-protocol.ts` both arrive as `unknown`, because that package cannot import agent-contracts; the reader decodes with `touchedSchema`. An absent `touched` on the socket is unknown, never `none`.

**`ReadOwner.native`** returns `NativeAnswer<OpResponseOf<K>>` until contract 6 replaces the second parameter with `OpEvidenceOf<K>`; writer D edits that line with it.

## Handles, reads, bindings, projection (reader C)

The frozen interface, landed by the freeze-ts writer before its consumers:

```ts
// C/handle.ts — frozen before wave 0. Shapes are final; K1 swaps the table behind handle(), K3 fills contract().
export type Effect = "Read" | "TransactRead" | "SessionWrite" | "WorkWrite" | "ModelWrite";
declare const minted: unique symbol;
export interface CommandHandle<K extends string = string, I = unknown, O = unknown, E extends Effect = Effect> {
  readonly [minted]: true;
  readonly key: K;
  readonly effect: E;
  readonly plan?: CommandHandle<string, I, unknown, "Read" | "TransactRead">;
  readonly via: "command" | { route: string };          // K6: the door picks the transport from this
  readonly _input?: I; readonly _output?: O;            // type only, no schema in the browser
}
export type RowKey = { kind: SubjectKeyKind; sub?: "port" | "field" };
export interface ReadHandle<K extends string = string, I = unknown, D = unknown> {
  readonly [minted]: true;
  readonly key: K;
  readonly input: z.ZodType<I>;
  readonly data: z.ZodType<D>;                          // added at the freeze: body() decodes a result with it
  readonly output: z.ZodType<Publication<D>>;           // Publication moves to C/value.ts
  readonly axes: CatalogAxes;                           // joined from uses: effect max, cost max, touches union
  readonly keyedBy: Readonly<Record<string, RowKey>>;   // dotted collection path; an unnamed collection is unkeyed
  readonly demand?: "mount" | "explicit";
}
export type InputOf<H> = H extends CommandHandle<string, infer I> ? I : never;
export declare function handle<K extends CommandKey>(key: K): CommandHandle<K, CommandInput<K>, CommandOutput<K>, CommandEffect<K>> & Planned<K, CommandInput<K>>;
// As landed: CommandKey is every key of K1's generated commandTable (semantic commands, raw native commands, pe-api routes);
// effect, plan and via come from its row. Input and output: hostActions first, then OpRequestOf/OpResponseOf, then the pe-api route.
// Planned makes `plan` required on a sealed write, so VerbDecl's `H extends { plan: object }` holds.
// CatalogReadKey lives in C/handle.ts; the host door re-exports it.
export declare function native<K extends CatalogReadKey>(key: K): ReadHandle<K, OpRequestOf<K>, OpResponseOf<K>>;
export declare function contract<K extends string, I, D>(key: K, def: {
  input: z.ZodType<I>; data: z.ZodType<D>;
  uses: readonly (ReadHandle<string, any, any> | CatalogReadKey)[];
  keyedBy?: Readonly<Record<string, RowKey>>; demand?: "mount" | "explicit";
}): ReadHandle<K, I, D>;

// H/reads/door.ts and evaluator.ts — the host half, frozen in the same commit
export declare function body<K extends string, I, D>(h: ReadHandle<K, I, D>, run: (ctx: ReadContext, args: I) => Promise<D> | D): Read<I, D>;
// As landed: read(name, def) and ctx.read(body | leaf) stay beside these until k2/read-sweep converts the route reads.
// ctx.firm and ctx.settings are gone. bodyOf(handle) is the registry lookup.
interface ReadContext {
  read<I, D>(h: ReadHandle<string, I, D>, args: I): Promise<D>;   // by handle; the registry resolves the body by key
  readonly files: {
    firm<T>(owner: string, schema: z.ZodType<T>, seed: T): Promise<FirmValue<T>>;
    tiers(owner: string, target: DocumentRef | null): Promise<SettingTierRead[]>;
  };
}
```

### As landed (k2/read-contract)

Where this differs from the frozen text above, this is the contract.

**The native handle's input.** `native(key)` is `ReadHandle<K, NativeArgs<K>, NativeValue<K>>`, not `OpRequestOf<K>` to `OpResponseOf<K>`:

```ts
type NativeArgs<K> = { request: OpRequestOf<K>; target: ExecutionTarget; version?: string; role?: "acquire" | "validate" | "join" | "beyond" | "none" };
type NativeValue<K> = { body: NativeReadOutput<K>; version: string | null };
```

- Reason: a native read cannot run without a target, and the ducts and fans bodies pass `role` and read back `version` (`W/ducts/host.ts:33-44`, `W/ducts/fan-sheet.ts:181-191`). A bare request would need a second door for those.
- So `ctx.read(native(key), args)` and `ctx.native(key, args)` are the same read, with the same body, input and value. `bodyOf(native(key))` is the host's native body; nobody registers one. k2/read-sweep can delete `ctx.native`.
- The schemas and both types live once, in `C/native-output-read.ts` (`nativeReadInput`, `nativeReadValue`). The handle and the host door both decode with them. `H/reads/door.ts` re-exports the types.
- A binding that names `native("revit.catalog.field-options")` as its options read supplies `request`; the door supplies `target`.

**`contract()`.**

- `input` is the host's input, `target` included where the body takes one. The browser door adds `target` from the mount, so a pane supplies the input without it. k2/read-sweep writes that one place; no `contract.ts` declares a second input.
- Effect, cost and touches join from `uses`. Subject and cardinality do not join: `contract()` takes an optional `subject` (default `"Document"`), and cardinality is `"One"`. The freeze took the first use's subject, which called `open.documents` and `chat.context` Document reads; the nine reads that take no model say `subject: "None"`.
- `uses` names every catalog Read the body reaches, through its host-only recipes too, and a `ReadHandle` where the body reads another contract. The 13 host-only recipes have no contract (cut), so `ducts.pricing` and `fans.sheet` name the natives under `fans.roster` and `fans.esp-options`.
- `usesOf(handle)` returns the keys a contract uses. It is a side table: `ReadHandle` gained no field.
- A `keyedBy` path that is not an array or a record in `data` throws when the contract is minted. Keyed today: `fans.sheet` (`rows`, `fans.rows`), `ducts.roster` (`rows`), `ducts.network` (`nodes`, `segments`, `groups`, `systems`), `rooms.workspace` (`snapshot.regions`), `families.view` (`pivotFamilies`). `pods.roster` is unkeyed: its `pods` schema is a decoded Effect schema the check cannot see into.

**The 15 `contract.ts` files** (19 reads) are `W/<route>/contract.ts` for captures, chat, duct-loss, ducts, families, family, fans, open, ops, pages-bind, pods, rooms, schedules, settings and takeoff. Each export is named as the route's `reads` key. `H/tests/read-contract.test.ts` holds each one equal to the schemas the host registers under that key, so the sweep is a move, not a rewrite. Keys are the host's: `ducts.roster`, not `ducts.roster.value`.

**Host registration.** `body(handle, run)` keeps its handle on the `Read` (`contract`). `readRegistry` and `register` throw `Host read <name> uses '<key>', which has no body on this host` when a used key has neither a `body()` nor a native body. Bodies register when their module loads, so the order of routes does not matter.

**Read lifetime.** `Publications` holds a flight per shared evaluation and one lease per subscriber. `release`, a superseding publish and an invalidated pending basis each release the slot's lease; the last release aborts the read's own signal. A retiring flight refuses a join, and the next subscriber starts its own read. The signal is the fourth argument of `InputPort.take` and the last of `ReadSources.call`; nothing reads it there yet (PI-P2's consumer edit, in k2/read-sweep). `Publications` takes an `StartFlight` as its third constructor argument: pass `(run) => ownership.flight(owner, run)` to bind flights to a `ReadOwner`. The default is `startFlight` from `H/reads/read-ownership.ts`: the lease count and the read's signal with no causal owner. `ReadOwnership.flight` is built on the same function.

**Firm settings file.** `readSettingsFile(path)` in `H/tiered-settings.ts` is the one reader of a `Settings/<owner>.json` file. `DuctFiles.firm` reads through it. A firm file that is JSON but not an object is now an error (`The file is not a JSON object`) instead of a schema refusal, and a byte-order mark no longer fails the parse.

**Handle and read context.** The TypeScript in section 1. Writers A, C, D, G.

**Wire shape of a route's verbs and gates.** Home `C/route-kernel-data.ts`. Writers B, G, H, E.

```ts
data.verbs[id] : { entry: string; label: string; effect: Effect; review: "none" | "shown" }
data.band      : readonly string[]                                  // verb ids, first is primary
data.panes[id] : { label: string; purpose: string; verbs: readonly string[] }   // placed verbs only
data.layout    : LayoutJson                                         // gates preserved
type Gate = { kind: "gate"; when: "subject" | { field: string; value: string }; child: LayoutJson }
// stages, stageOrder, predicates and the five verb kinds are gone from the wire
```

**Verb declaration.** Home `W/route/typed-route.ts`. Writers G and B.

```ts
type VerbDecl<C, H extends CommandHandle = CommandHandle> = {
  readonly handle: H; readonly label: string;
  readonly input?: (ctx: VerbContext<C>, supplied?: unknown) => InputOf<H>;
} & (H extends { plan: object } ? { present(result: unknown, ctx: VerbContext<C>): Presentation } : { present?: never });
// Specification: verbs keyed by verb id; band: verb ids; panes[id].verbs: verb ids. A verb is in band or in exactly one pane.
```

As landed (k2/verbs):

- `VerbContext<C>` is `{ page, target, work, value, doc }`; `present` gets it with `value` and `doc` present. `input` returns the handle's input without `work` and `readWorks`, which the mount binds. Without `input`, what the press supplies is the input.
- A body names its verbs apart from the route, as `ContextOf<F, R, W, E, Verbs<run ids, plan ids>>`. `ctx.verb(id)` returns a `RunVerb` (`run`) or a `PlannedVerb` (`plan`, `apply`, `cancel`, `read`); an id the route did not declare fails `tsc` at the route's `draw`.
- `handle()` and the command types live in `C/command-handle.ts`, which imports the generated table and types only. `C/handle.ts` re-exports it and keeps `native()` and `contract()`. `route()` imports the command half, because `handle.ts` reaches the native catalog and a Pod bundle may not. A Pod takes `handle` from `@pe/web/route`.
- A route module's `entries` still names each verb's command and plan by key, for the linker, with the generated table's axes and no schema.
- `mount.verb(id)` returns the union; `planned(verb)` and `direct(verb)` in `typed-mount.ts` narrow it for a holder of only the id.

**Read lifetime.** Home `H/reads/read-ownership.ts`, Picture's file. Writer C codes against it.

```ts
export interface ReadLease { release(): void }           // idempotent
export interface ReadFlight<T> { readonly result: Promise<T>; join(): ReadLease; readonly settlement: Promise<CausalTerminalState> }
// The final release signals the read only. It never detaches a write or a restoration.
```

**Domain and home.** Home `C/slots/sheet.ts`, `fans-ux.md` section 3.1. Writer D and Storage's ST7.

```ts
type Domain = NumberDomain | EnumDomain<unknown> | OptionsDomain | { kind: "object"; fields: Readonly<Record<string, Domain>> };
declare function schemaOf(domain: Domain): z.ZodType;    // the one derivation; browser and host both call it
export const settingOwners: Readonly<Record<string, SettingOwner>>;   // C/setting-owners.ts
```

**Clock and id.** Home `H/command-executor.ts`. F9 and F1.

```ts
readonly clock: { now(): string };    // ISO time
readonly ids: { mint(): string };
```


## Shell, findings, band, closed folders (reader D)

**Reading state** (S6 gives; C5, F4, every body writer take). Home `C/route-kernel-bodies.ts`.

```ts
export type ReadingState<T> =
  | { state: "ready" | "refreshing" | "stale"; value: Immutable<T>; reason?: string }
  | { state: "reading" | "not-yet-run" }
  | { state: "refused"; reason: string };
export type Present<T> = Extract<ReadingState<T>, { value: unknown }>;
// DrawContext, W/route/typed-route.ts
readonly value: Present<D>;                       // absent from the type when the pane has no read
read<R extends HostRead>(read: R): ReadingState<ReadData<R>>;   // body narrows on `"value" in`
absent(state: Exclude<ReadingState<unknown>, { value: unknown }>): ReactNode;
readonly cells: { readonly state: ReadingState<W>; /* replaces ready + refusal */ };
```

Mapping from today, one to one: `pending` with a value is `refreshing`, `pending` alone is `reading`, `unavailable` with a value is `stale`, `unavailable` alone is `refused`. The shell keeps emitting `aria-busy` and `data-url-settled`.

As landed (SH-S6):
- The gate is in `mount.draw`: a pane whose read is value-less gets the shell's one line (`W/shell/reading-line.tsx`, marked `data-reading`) and its body does not run. A pane with no read always draws. Every pane reads the core unless it names another read.
- A pane whose control clears the core's refusal names its own read, or the route is a dead end. Three do: ducts `e-systems` and fans `sheet-roster` name the roster, takeoff `adoption` names the view catalogue. Such a body reads the core with `ctx.read(core)` and narrows. Demand follows visible panes (`visibleReads`), so when no other pane reads the core the route declares it in `reads`, as takeoff does; ducts and fans keep ungated panes on the core.
- `refusalOf(state)` (the shell's sentence, null when ready) and `valueOf(state)` (the held value) live in `W/route/typed-route.ts`. `ctx.cells.state` is ready only when Work can be edited; a held doc that cannot be edited is `refreshing` or `stale` with the reason.
- The kit's `ValueHandle` is `{ state, value?, reason? }`, so a reading state fits it with no adapter.
- A read has no `demand`: every declared read runs at mount.

**Findings record and doors** (F1 gives; F2, F4, F5, F10, C2 take). Home `C/slots/findings.ts`.

```ts
export const FINDING_KINDS = { note: [], claim: ["yes", "no", "not-this"], check: ["pass", "fail"] } as const;
export type Stamp = { readonly by: "pea" | "person"; readonly at: string };
// Finding: { id (host-minted), kind, subject: SubjectRefCode, text, said: Stamp, mark?, verdict? (never on a note) }
export const FINDINGS_DOORS = { list: "findings.list", say: "findings.say", rule: "findings.rule", retract: "findings.retract" } as const;
// say { subject, kind, text, mark?, verdict? } -> { id, revision }
// rule { id, value: string | null } -> { revision }      retract { id } -> { revision }
// list { subject? } -> { findings }, sorted by said.at
```

F1 also edits `typed-mount.ts:456` and `graph-history.tsx:35` to the new door keys, and keeps a `FindingInput` type export until F4 deletes its two users.

**Kernel verbs** (F1 writes the table, S2 writes the reader). Table home `W/route/slots/findings/index.ts`.

```ts
export type KernelVerbKey = "findings.say" | "findings.rule" | "findings.retract" | "pointers.dismiss" | "pointers.keep";
export const kernelVerbs: Readonly<Record<KernelVerbKey, { handle: CommandHandle; label: string; chord?: Chord }>>;
mount.kernelVerb(key: KernelVerbKey): VerbHandle;   // S2, in typed-mount.ts; only reads the table
```

If cut 5 is taken, `pointers.keep` leaves the union.

**Placement on a mount** (S2 gives; C5, C6, F4, P1, S4 take). Home `W/shell/typed-mount.ts`.

```ts
mount.placement(): { band: readonly string[]; panes: Readonly<Record<string, readonly string[]>> };  // band[0] is primary
mount.verb(id): VerbHandle;   // label, chord, effect, pending, refusal, failure; plan/apply/cancel/read only when the handle has `plan`
```

**Band pieces** (commit 0 gives; S6, S2, C3, C4, C5 take). Home `W/shell/typed-shell.tsx`, or a new `band.tsx` beside it. Four components over `{ mount }`: context (document, subject, revision), alerts (readiness, retained value, problem, absent owners, reviews), verbs (Start, band verbs), timeline. C5 composes them and owns nothing inside one.

**Subject namer** (F10 gives; F4, F5, the Timeline label take). Home `W/route/slots/subject-name.ts`.

```ts
export type SubjectNamer = (code: SubjectRefCode) => string | null;   // null: the kernel shows the key kind and a short key
```

**Route-closure guard** (D1 writes; C7, P3, S7a are measured by it). Home `ts/tests/repo-guards/src/route-closure.guard.test.ts`. Three rules over non-test files (`.test.`, `.test-support.`, `.fixture.` exempt; `design-system` exempt both ways): no route folder imports another route folder; no shared web folder imports a route folder; no route folder imports `peClient`, `callOp`, `callCompose`, `callHostRpc`, `hostFetch` or calls `fetch(`. A route folder is a directory under `W/` that holds `route.ts`. C7's falsifier is this guard with the folder list narrowed to `chat`.

