# Slots scaffold: the shape three fills code against

Scaffold for [MAP](MAP.md) rows 7, 8 and 9 on `crusade/kernel-slots-scaffold` (from the slice 5 candidate 4fb8159a). It commits types, stub seams and three red falsifiers, and no slot behavior. Rulings: [ADR 0035](../../adr/0035-route-slots-subjectref-one-notice-feed.md) rules 1 to 4, 8, 9 and 12; [ADR 0030](../../adr/0030-pea-first-goal-core-plan-statecell.md) rules 3, 4, 8, 9 and 10; [ADR 0026](../../adr/0026-one-route-shell.md) layers and D1 to D8. Delete this file when slice 9 lands; what survives goes to the [routes ledger](LEDGER.md).

## What the scaffold is

- **Contracts**, one file per slot, under `ts/packages/agent-contracts/src/slots/` and exported as the subpath `@pe/agent-contracts/slots` (not the barrel: `rooms.ts` already exports `Mark` and `markSchema`). `index.ts` names the five slots.
- **The declaration** is today's typed `route()`: `Specification` in `ts/apps/web/src/route/typed-route.ts` gains `sheet?`, `picture?`, `goal?`, `query?` and `title?(ctx)` beside the existing `subject` and `layout`. Types are inferred from the declaration (rule 4); `route()` folds `query` into the projected fields and registers `goal` as the reading `goal`.
- **Kernel seams**, one directory per slot under `ts/apps/web/src/route/slots/<slot>/` and one host file per slot that reaches the host under `ts/apps/host/src/slots/<slot>.ts`. Every seam throws `not implemented: slice N (<what>)`.
- **Falsifiers**, one red test per slice beside its web seam. Run from `ts/apps/web` with `vp test run src/route/slots`.

Red at the scaffold SHA, each for its stub's reason:

```
× slice 7: the sheet slot draws a binding's StateCells, and a ModelWrite binds a plan whose effect is Read or TransactRead
  Error: not implemented: slice 7 (sheet slot draws a binding's StateCells)      src/route/slots/sheet/index.ts:25
× slice 8: point, select and frame a linked fan port in two placements, and inspect an empty region, with no route translator
  Error: not implemented: slice 8 (picture slot points, selects, frames and inspects)   src/route/slots/picture/index.ts:48
× slice 9: Pea and a person each write a finding on a fan port and a /families row; findings.list returns each; undo leaves the other; a note with a verdict is refused; one mark draws on the port's geometry
  Error: not implemented: slice 9 (findings Work per document, list, write, undo)   src/route/slots/findings/index.ts:23
```

Rules every fill keeps: deletion over addition; one path per capability; no second parser (a Pod decodes the slot data schemas in these files, nothing else); route modules import no `Pane` or `GraphLayoutView` (slice 6 adds the guard; add no new export either); a slice lands only when its falsifier is green at the landed SHA and every line in its Deletes column is gone.

## Slice 7: sheet slot, goal slot, Pod doors, V3

### File set (owned)

- `ts/packages/agent-contracts/src/slots/sheet.ts`, `ts/packages/agent-contracts/src/slots/goal.ts`
- `ts/apps/web/src/route/slots/sheet/**`, `ts/apps/web/src/route/slots/goal/**`
- `ts/apps/host/src/slots/sheet.ts`
- New: the generic parameter-set ModelWrite in C# (`dotnet/Pe.Revit.Global/Lib/Parameters/`, registered in `dotnet/Pe.App/Services/Host/RevitDataRequestService.cs`), its codegen output under `ts/packages/host-contracts/src/generated/`, and the first example Pod at `examples/pods/hydronic/` (from `crusade/author-pod`).

May also edit: `ts/apps/web/src/route/typed-route.ts` (the `sheet` and `goal` keys and their projection into `data`), `ts/packages/agent-contracts/src/semantic-actions.ts` and `command-axes.ts` (register `sheet.plan` and `sheet.apply`), `ts/apps/host/src/ducts-actions.ts`, `ts/apps/web/src/fans/route.ts`, `ts/apps/web/src/ducts/route.ts`, `ts/apps/web/src/ducts/sheet/mount.tsx` (owned by 7 until it lands; slice 8 takes the two web files after), `ts/apps/host/src/app.ts` and `ts/packages/mcps/src/pea/routes.ts` (V3), `ts/apps/host/src/reads/evaluator.ts` and `ts/apps/host/src/reads/inputs.ts` (the merged Pod door).

### Contract, verbatim

From `slots/sheet.ts`:

```ts
export const BINDING_KINDS = ["parameter", "store", "local"] as const;
export type BindingPer = "subject" | "route";
export type SheetBinding<V extends z.ZodType = z.ZodType> =
  | { kind: "parameter"; parameter: string; schema: V; per: "subject" }
  | { kind: "store"; store: string; schema: V; per: BindingPer }
  | { kind: "local"; schema: V; per: BindingPer };
export const parameter = <V extends z.ZodType>(parameter: string, schema: V) => ...;
export const store = <V extends z.ZodType>(store: string, schema: V, per: BindingPer = "subject") => ...;
export const local = <V extends z.ZodType>(schema: V, per: BindingPer = "route") => ...;
export interface SheetSlot<B extends Readonly<Record<string, SheetBinding>> = ...> { readonly bindings: B; }
export interface CellAddress { readonly binding: string; readonly subject?: SubjectRefCode; }
export type CellSource = "work" | "model-store" | "firm" | "default" | "model";
export interface StateCell<V = unknown> extends CellAddress {
  readonly kind: BindingKind;
  readonly value: V | null;
  readonly model: V | null;
  readonly pending: { readonly by: "person" | "pea"; readonly value: V; readonly at: string } | null;
  readonly drift: boolean;
  readonly freshness: "fresh" | "stale" | "unverified" | "never";
  readonly source: CellSource;
}
export interface ModelValue<V = unknown> extends CellAddress { readonly value: V | null; readonly freshness: StateCell["freshness"]; }
export const SHEET_COMMANDS = { plan: "sheet.plan", apply: "sheet.apply" } as const;
export const sheetSlotDataSchema = z.strictObject({ bindings: z.record(z.string(), z.discriminatedUnion("kind", [...])) });
```

From `slots/goal.ts`:

```ts
export type Resolver = "person" | "pea" | { readonly op: string };
export interface Closer { readonly id: string; readonly says: string; readonly resolver: Resolver; readonly subject?: SubjectRefCode; }
export type GoalResult<R> =
  | { readonly kind: "complete"; readonly value: R }
  | { readonly kind: "estimate"; readonly value: R | null; readonly sources: readonly string[] };
export interface Goal<R = unknown> {
  readonly unresolved: readonly Closer[];
  readonly assumed: readonly Closer[];
  readonly next: Closer | null;
  readonly inputs: readonly StateCell[];
  readonly result: GoalResult<R>;
}
export const goalSchema = <R extends z.ZodType>(result: R) => z.strictObject({ ... });
```

Seams (web `slots/sheet/index.ts`, `slots/goal/index.ts`; host `slots/sheet.ts`):

```ts
export interface SheetInput<W = unknown> { readonly rows: readonly SubjectRefCode[]; readonly work: Immutable<W> | null; readonly model: readonly ModelValue[]; }
export function sheetCells(slot: SheetSlot, input: SheetInput): readonly StateCell[];
export interface GoalView<R = unknown> { readonly unresolved; readonly assumed; readonly next; readonly answer: { readonly value: R | null; readonly greyed: boolean; readonly sources: readonly string[] }; }
export function goalView<R>(goal: Goal<R>): GoalView<R>;
export function sheetPlan(input: SheetPlanInput): Promise<SheetPlan>;   // a Read: derives writes from Work, returns the seal, opens no transaction
export function sheetApply(seal: WriteSeal): Promise<{ readonly applied: number }>;   // the ModelWrite that takes the seal
```

On the declaration (`typed-route.ts`):

```ts
  sheet?: SheetSlot;
  goal?: HostRead & { output: z.ZodType<Publication<Goal>>; args(page: Page<NoInfer<F>>): unknown };
```

The falsifier pins the cell order (rows then bindings), `value`/`model`/`drift`/`source` per cell, and that `sheet.apply` is a ModelWrite whose `writeBoundary.previewKey` is `sheet.plan` with effect Read or TransactRead (the existing linker rule, `ts/packages/agent-contracts/src/catalog.ts:83-92`, admits it). The Pod half is the Pod author's red tests on `crusade/author-pod` at `examples/pods/hydronic/routes/sizing/sizing.test.ts`: `kernel gap: sheet-slot (3)`, `parameter-binding (4)`, `pod-native-read-door (2)`, `pod-document-work (4)`, `firm-file-layer (3)`, `pea-stages-pod-work (4)`, `goal-slot (6)` and `pod-parameter-write (8)` (`authors/pod/gaps.json`). Referenced, not copied; each turns from `test.fails` to a plain test when the capability lands.

### Deletes (MAP row 7), with anchors

- Hydronic `mount.tsx`: no file by that name exists; the builtin specimen on `crusade/author-builtin` is `ts/apps/web/src/hydronic/{route,sizing,members}.ts` plus its tests and is never merged (MAP, Author witnesses). Nothing to delete on this branch.
- Fans' borrowed `InputsBody`: `ts/apps/web/src/fans/route.ts:102` draws `ts/apps/web/src/ducts/sheet/mount.tsx:186` (`InputsBody`); the sheet slot replaces both.
- Hand-written plan and apply registration: `ts/apps/host/src/ducts-actions.ts:356-357` (`ducts.apply` bound to `ducts.apply.plan`) and `:431-433`; `ts/packages/agent-contracts/src/semantic-actions.ts:366-383` (the three `workWriteCommands` pairs). The one `sheet.plan`/`sheet.apply` pair replaces the losses pair; heal and assign-fan stay until their own owner moves.
- `ducts.apply.preview` as a false TransactRead (wave 2 V1): already retired in code by ADR 0030 rule 4. `ducts.apply.plan` is `intent: "Read"` (`ts/packages/host-contracts/src/generated/host-catalog.generated.ts:246-248`) and `command-axes.ts:447` derives Read for a plan; the only TransactRead previews left are the declared rehearsals `ducts.rehearse-heal` (`command-axes.ts:244-247`) and `ducts.rehearse-assign-fan` (`:252-255`). The falsifier's second half keeps it retired for the new pair.

### V3 (lands with slice 7)

The host filters admitted routes out of Pea's Work tools: `ts/apps/host/src/app.ts:318` registers `createRouteRegistrations()` from `ts/packages/mcps/src/pea/routes.ts:17-30`, which maps `Object.values(tools)` (the builtin table) and nothing admitted. The fix: registrations derive from every admitted route, builtin and Pod, through the host's route admission (`HostWorkRegistration`), so the hydronic Pod's Work is a Pea door and `kernel gap: pea-stages-pod-work (4)` turns green. No projection filters routes out of Pea's doors (ADR 0030 rule 1).

### Inputs already built to merge

1. `crusade/kernel-pod-read-door` (583805eb): `ReadContext.native(key, args)` typed by the generated catalog for any catalog Read, and `ctx.firm(owner, schema, seed)` as the firm file layer resolved from `Firm/<owner>.json`; `nativeRead`, `documentMark` and `assetFile` move from `reads/inputs.ts` into the read-graph module (`@pe/host/read-graph` is `ts/apps/host/src/reads/evaluator.ts`). Closes the Pod gaps `pod-native-read-door (2)` and `firm-file-layer (3)`. 28 files against this base.
2. `crusade/kernel-piping-reads-2` (7e396b4a): the generic C# MEP reads `mep.system.members` and `mep.segment.sizes` in `dotnet/Pe.Revit.Global/Lib/Mep/` (`MepSystemReads.cs`, `MepConnectors.cs`, `MepContracts.cs`), their tests, and the regenerated catalog projections. The Pod author's warning: it conflicts with this base only on `ts/packages/host-contracts/src/generated/ops-catalog.sha`, resolved by running `pnpm codegen` from `ts` after the merge (never by hand).

### Order

Merge the read door first, then the piping reads, then regenerate. Slice 7 lands before 8 and 9 (ADR 0035 rule 12: sheet, picture, findings). The goal slot replaces the ducts `e-inbox` pane (`ts/apps/web/src/ducts/route.ts:135`, `:190`) with the unresolved list (rule 8). The Pod's Revit apply is driven live on a controlled document before the slice is called done (D8; kaitpw: "I have yet to see with my own eyes a pod route successfully binding, reading and applying a revit doc").

## Slice 8: picture slot

### File set (owned)

- `ts/packages/agent-contracts/src/slots/picture.ts`
- `ts/apps/web/src/route/slots/picture/**`
- `ts/apps/web/src/scene/**` (the capture must carry a SubjectRef per port; the ledger owes "whether the fans scene capture carries a UniqueId per port")

May also edit, after slice 7 lands: `ts/apps/web/src/fans/route.ts`, `ts/apps/web/src/ducts/route.ts`, `ts/apps/web/src/ducts/sheet/mount.tsx` and `picture.tsx`, `ts/apps/web/src/route/defaults.ts` (`poseFields`), `ts/packages/agent-contracts/src/routes/picture.ts`, `ts/apps/web/src/fans/bindings.ts`, `ts/apps/web/src/ducts/selection.ts`, `ts/apps/web/src/ducts/cell-focus.ts`, `ts/packages/kit/src/components/lang/attention.tsx` (`elementKey`/`elementUniqueId`, by a red `kernel gap:` test to the kit owner, never a local patch), `ts/apps/web/src/route/typed-route.ts` (the `picture` key's projection into `data`). Nothing under `slots/sheet`, `slots/goal`, `slots/findings` or `apps/host/src/slots/`.

### Contract, verbatim

From `slots/picture.ts`:

```ts
export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];
export interface Frame { readonly origin: Vec3; readonly x: Vec3; readonly y: Vec3; }
export type PictureScope =
  | { readonly kind: "subjects"; readonly refs: readonly SubjectRefCode[] }
  | { readonly kind: "box"; readonly min: Vec3; readonly max: Vec3 }
  | { readonly kind: "prism"; readonly frame: Frame; readonly polygon: readonly Vec2[]; readonly depth: Vec2 };
export const MARK_KINDS = ["ring", "outline", "bar", "volume", "label"] as const;
export type MarkAt = SubjectRefCode | { readonly point: Vec3 } | { readonly from: Vec3; readonly to: Vec3 };
export interface Mark { readonly kind: MarkKind; readonly at: MarkAt; readonly ink?: string; readonly says?: string; }
export interface PictureSlot<C = unknown> {
  readonly scope: "subject" | { derive(ctx: C): PictureScope };
  marks?(ctx: C): readonly Mark[];
}
export const pictureScopeSchema, markSchema;
export const pictureSlotDataSchema = z.strictObject({ scope: z.enum(["subject", "derived"]), marks: z.array(z.enum(MARK_KINDS)).readonly() });
```

Seam (`slots/picture/index.ts`):

```ts
export interface Captured { readonly ref: SubjectRefCode; readonly point: Vec3; }
export interface PictureInput { readonly subject: readonly SubjectRefCode[]; readonly captured: readonly Captured[]; }
export interface PictureState { readonly scope: PictureScope; readonly pointed; readonly selected; readonly viewport: { readonly center: Vec3; readonly radius: number } | null; }
export interface PictureHandle {
  read(): PictureState;
  point(ref: SubjectRefCode): void;          // Pea's pointer: never writes the selection (ADR 0030 rule 10)
  select(refs: readonly SubjectRefCode[]): void;
  frame(refs: readonly SubjectRefCode[]): void;
  inspect(scope: PictureScope): { readonly members: readonly SubjectRefCode[] };   // an empty region answers [], never refuses
  marks(): readonly Mark[];                  // declared marks plus one per pointed ref, each resolved to geometry
}
export function pictureSlot<C>(slot: PictureSlot<C>, ctx: C, input: PictureInput): PictureHandle;
```

On the declaration: `picture?: PictureSlot<DrawContext<NoInfer<D>, NoInfer<F>, z.output<W>, z.output<Edit>>>`. `scope` is a method-shaped object and `marks` a method so a route's concrete context assigns to the kernel's `TypedRoute`; a function property would make the slot contravariant and break every spec spread.

The falsifier builds one fan port (`UniqueId:<fan>#port:1`) seen through two link placements (`@<host>/<link-a>` and `@<host>/<link-b>`), hands the slot only the subject and the capture (no translator exists in the input type), and pins: point leaves the selection empty, select holds both placements, frame sets the viewport to their fit, an empty prism inspects to `[]`, the pointed port draws one ring at its captured point, and a Pod's `{ scope: "subject", marks: ["ring", "label"] }` decodes while `"arrow"` is refused. The Pod half is `kernel gap: picture-slot (5)` on `crusade/author-pod`.

### Deletes (MAP row 8), with anchors

- `poseFields`: `ts/apps/web/src/route/defaults.ts:60-82`; its callers `ts/apps/web/src/fans/route.ts:31-39` and `ts/apps/web/src/ducts/route.ts:35-43`.
- `ductsPictureFields` on fans: `ts/apps/web/src/fans/route.ts:26` (`const shared = ductsPictureFields`); the definition `ts/packages/agent-contracts/src/routes/picture.ts:86-91` and its barrel export `ts/packages/agent-contracts/src/index.ts:35`.
- Route-authored SceneRequests: `ts/apps/web/src/ducts/sheet/picture.tsx:388` (`sceneRequest(...)`) over `ts/apps/web/src/scene/host.ts:6`; the type `ts/apps/web/src/scene/scene-controller.ts:7`. The slot builds the request from the scope.
- Halo and context aliases: the `halo`/`context` layer keys `ts/packages/agent-contracts/src/routes/picture.ts:77-78` and `contextStyle` `:44`; the `contextOn` alias `ts/apps/web/src/ducts/sheet/picture.tsx:177`.
- Selection-string bridges: `ts/apps/web/src/fans/bindings.ts:6` (`attentionSubjects` over `ductElements`), `ts/apps/web/src/ducts/cell-focus.ts:42`, `ts/apps/web/src/ducts/selection.ts:18-19`, and the kit's `elementKey`/`elementUniqueId` `ts/packages/kit/src/components/lang/attention.tsx:39-45`.
- The borrowed picture body: `ts/apps/web/src/fans/route.ts:108` draws `ts/apps/web/src/ducts/sheet/mount.tsx:359` (`PictureBody`); ducts draws its own at `ts/apps/web/src/ducts/route.ts:133`.

### Order

Branches from this scaffold; rebases onto slice 7's landing before touching `fans/route.ts`, `ducts/route.ts` or `ducts/sheet/mount.tsx`. Lands before slice 9 (slice 9's mark seam consumes `Captured` from this slot's seam).

## Slice 9: findings

### File set (owned)

- `ts/packages/agent-contracts/src/slots/findings.ts`
- `ts/apps/web/src/route/slots/findings/**`
- `ts/apps/host/src/slots/findings.ts`

May also edit: `ts/packages/agent-contracts/src/pointers.ts` (rule 9: `target: SubjectRef | Place`, no journal, a keep verb; not changed by the scaffold), `ts/packages/agent-contracts/src/ducts.ts` (`ductClaimSchema` and the `claims` cell), `ts/packages/agent-contracts/src/rooms.ts` (notes), `ts/apps/web/src/rooms/cards.ts`, `ts/apps/web/src/ducts/proto/e/inbox*.tsx` and `inbox-write.tsx`, `ts/apps/web/src/ducts/inbox-rows.ts`, `ts/apps/web/src/ducts/finding-layers.ts`, `ts/apps/web/src/ducts/claims.tsx`, `ts/packages/agent-contracts/src/semantic-actions.ts` and `command-axes.ts` (register `findings.list` and `findings.write`; the same two files slice 7 edits for `sheet.*`, so slice 9 rebases on 7 and adds its own keys only), `ts/packages/runtime/src/route-workspace.ts` and `work-journal.ts` (the per-author undo the ledger owes). Nothing under `slots/sheet`, `slots/goal`, `slots/picture`, `fans/`, `ducts/sheet/` or `apps/host/src/slots/sheet.ts`.

### Contract, verbatim

From `slots/findings.ts`:

```ts
export const FINDING_KINDS = { note: [], claim: ["yes", "no", "not-this"], check: ["pass", "fail"] } as const;
export const FINDINGS_OWNER = "findings" as const;
export const FINDINGS_DOORS = { list: "findings.list", write: "findings.write" } as const;
export const findingSchema = z.strictObject({
    id, subject: subjectRefCodeSchema, kind, text, by: z.enum(["person", "pea"]), at: z.iso.datetime(),
    verdict: z.string().optional(), place: z.record(z.string(), z.string()), mark: markSchema.optional(),
  }).refine((f) => f.verdict === undefined || FINDING_KINDS[f.kind].includes(f.verdict), { error: "a verdict must be one the finding's kind declares; a note declares none" });
export const findingsWorkSchema = z.strictObject({ findings: z.record(z.string(), findingSchema).default({}) });
export const findingsWork = { route: "findings", title: "Findings", description, schema: findingsWorkSchema, schemaVersion: 1, editable: [["findings", "*"]] } satisfies RouteStateSpec<...>;
```

Seams (`slots/findings/index.ts`; host `slots/findings.ts`):

```ts
export function findingMark(finding: Finding, captured: readonly Captured[]): Mark;   // its own mark, else a ring on the subject's geometry
export function findingsList(document: DocumentRef, subject?: string): Promise<readonly Finding[]>;        // a Read
export function findingsWrite(document: DocumentRef, finding: Finding): Promise<{ readonly revision: number }>;   // a Work write, never a ModelWrite
```

Nothing on the declaration: findings is an implicit kernel module (rule 1).

Per-author undo is the host's Work journal: the history door passes `own` for the findings route, and `findings.write` stamps `by` from the caller. The host falsifier (`apps/host/tests/findings.test.ts`) writes through those doors, and Pea's undo leaves the person's finding. The web falsifier refuses a `note` with `verdict: "yes"` and a `claim` with `"maybe"` at the contract, draws one ring at the port's captured point, and expects both doors in `linkedCatalog()` (the Pod author's `kernel gap: findings (7)`).

### Deletes (MAP row 9), with anchors

- `ductClaimSchema`: `ts/packages/agent-contracts/src/ducts.ts:83-96`, its `claims` cell `:360` and projection `:417`, and the claims paragraph in the Work description `:645`.
- Rooms notes: `noteSchema` `ts/packages/agent-contracts/src/rooms.ts:60-67` and the `notes` record `:74`; the rendering `ts/apps/web/src/rooms/cards.ts:187` and `:255`.
- The ducts proto inbox as a notice surface: `ts/apps/web/src/ducts/proto/e/inbox.tsx`, `inbox-write.tsx`, `inbox.test.tsx`, `ts/apps/web/src/ducts/inbox-rows.ts` (the re-export of `@pe/ducts-domain/inbox-rows`) and its `e-inbox` pane, after slice 7's goal slot has taken the unresolved list (`ts/apps/web/src/ducts/route.ts:135`, `:190`).

### Order

Branches from this scaffold; rebases onto slices 7 and 8 before landing. Needs the ledger's owed "Work undo per document (ADR 0030 rule 9)"; the fill owns it in `packages/runtime`. Its 3D mark needs slice 8's `Captured` to carry a SubjectRef per port.

## Defaults, re-openable

1. The slot contracts are a package subpath `@pe/agent-contracts/slots`, not barrel exports, because `rooms.ts` already exports `Mark` and `markSchema` through the barrel.
2. A `parameter` binding is always per subject row; `store` defaults to per subject; `local` defaults to per route (`per: "subject" | "route"`).
3. A StateCell's `source` names the layer that supplied `value` in ADR 0026 order (`work`, `model-store`, `firm`, `default`), or `model` when nothing above the model holds one; `drift` is `value !== model`. The falsifier pins `["chosen", a, 25, 20, true, "work"]` and `["chosen", b, 32, 32, false, "model"]`.
4. One plan/apply pair, `sheet.plan` and `sheet.apply`, serves every sheet (builtin and Pod); the generic parameter-set ModelWrite in C# is slice 7's to write. A Pod adds no native op (ADR 0030 rule 12), so this pair is the Pod's only road to Revit.
5. The Goal is its own host Read on the declaration (`goal`), registered by `route()` as the reading `goal`, rather than folded into `core`; a route whose core already returns a Goal points both at the same read.
6. A picture scope is `"subject"` by default; a derived scope is `{ derive(ctx) }` and marks are `marks?(ctx)` (method signatures, for the bivariance `TypedRoute` needs). The Pod data projection is `{ scope: "subject" | "derived", marks: MarkKind[] }`.
7. The closed mark kinds are the ducts cases' illustrations: `ring`, `outline`, `bar`, `volume`, `label`. A mark sits on a SubjectRef (the kernel resolves it) or at model feet.
8. The picture seam takes `{ subject, captured }` and nothing else; `Captured` is a SubjectRef plus its point. There is no translator slot in the type, which is how "no route translator" is pinned.
9. Finding kinds: `note` (no verdict), `claim` (`yes`, `no`, `not-this`, from `DUCT_CLAIM_VERDICTS`), `check` (`pass`, `fail`). `place` reuses `Pointer.place`'s shape (attention codec text by field). `mark` is optional; absent means the subject's own geometry.
10. Findings undo is per author: `undo(by)` restores that author's last preimage and leaves the other author's writes (ADR 0026: Ctrl+Z reverts only the person's own edits; ADR 0030 rule 9: one journal per Work).
11. `query` folds into `fields` inside `route()` and `fields` stands until slice 10; `title(ctx)` passes through on `spec` and nothing draws it until slice 6's chrome lands. The data projection does not change at the scaffold (`route-graphs.ts --builtin-closure-only` regenerates nothing).
12. A test that spreads a real spec into another route resets `picture` and `title` to `undefined`, the idiom those tests already use for `core` and `subject` (`kernel-journeys-focus.test.tsx`, `pea-casing.test.tsx`).
13. The Pointer contract change (`target: SubjectRef | Place`, a keep verb) is slice 9's, not the scaffold's.
14. Host seams live under `ts/apps/host/src/slots/`, outside `reads/`, whose per-file ownership table (`tests/repo-guards/src/kernel-route-names-census.ts`) is reviewed by hand.
15. The host-door, route-kernel-boundary and kernel-route-names guards pass unchanged: the seams import no transport and sit outside every censused directory.
