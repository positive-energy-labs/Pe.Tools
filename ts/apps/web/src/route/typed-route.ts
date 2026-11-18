import type {
  HostRouteModule,
  Immutable,
  RouteGraphWire as RouteGraphJson,
  RouteStatePatch,
  RouteStateSpec,
  ReadingState,
  Present,
  LayoutJson,
  InvocationToken,
  EntryContract,
  Many,
} from "@pe/agent-contracts";
import { subjectOf, type SubjectRefCode } from "../../../../packages/agent-contracts/src/subject-ref.ts";
export { oneName, nameOf } from "../../../../packages/agent-contracts/src/subject-ref.ts";
import { subjectSchema } from "@pe/agent-contracts/route-kernel-codecs";
import type { PlanHandle as importPlanHandle } from "@pe/kit/lang/write-action";
import { z } from "zod";
import type { Publication } from "@pe/agent-contracts/value";
// The command half of the handles only: `handle.ts` also holds the native catalog, which no Pod bundle may reach.
import { handle, type CommandHandle, type Effect, type InputOf } from "../../../../packages/agent-contracts/src/command-handle.ts";
/** A Pod declares its verbs with this: the same mint the builtin routes take from the contracts package. */
export { handle };
import type { KernelVerbKey } from "./slots/findings/index.ts";
import { linkRouteGates } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import { picturePoseSchemas, pictureSlotData, sheetSlotData, writesRevit, SHEET_COMMANDS, type Goal, type PictureScope, type PictureSlot, type SheetSlot } from "@pe/agent-contracts/slots";

// The generated table is data only: no command schema reaches the browser or a Pod bundle. The host decodes inputs.
import { commandCatalogAxes } from "@pe/agent-contracts/command-axes";
import { fillBody, scrollBody, type Body, type BodyKind } from "./body.ts";
export { scrollBody, fillBody, type Body, type BodyKind } from "./body.ts";

import type { FieldCodec } from "./field-codec";
type Field = {
  schema: z.ZodType;
  initial: unknown;
  role: "pose" | "query" | "subject" | "stage";
  url: "push" | "replace";
  share?: false;
  codec?: FieldCodec;
};
export const whenSubject = (child: string | LayoutJson): LayoutJson => ({
  kind: "gate", when: "subject", child: typeof child === "string" ? { kind: "pane", id: child } : child,
});
/** Field names and values come from the same declaration, never a free-form predicate id. */
export const when = <const F extends Fields, K extends keyof F & string>(
  fields: F, key: K, value: NoInfer<z.output<F[K]["schema"]>> & string, child: string | LayoutJson,
): LayoutJson => {
  fields[key]!.schema.parse(value);
  return { kind: "gate", when: { field: key, value }, child: typeof child === "string" ? { kind: "pane", id: child } : child };
};
export function gateActive(condition: string | import("@pe/agent-contracts").GateWhen, page: Readonly<Record<string, unknown>>, subject?: string): boolean {
  if (typeof condition === "object") return page[condition.field] === condition.value;
  if (condition !== "subject") return false;
  const held = subject ? page[subject] : undefined;
  return typeof held === "object" && held !== null && (("kind" in held && held.kind === "all") || ("ids" in held && Array.isArray(held.ids) && held.ids.length > 0));
}
/** Only panes surviving gates own demand; shared reads stay alive while any visible pane uses them. */
export function visibleReads(spec: TypedRoute["spec"], page: Readonly<Record<string, unknown>>) {
  const active = new Set<HostRead>(Object.values(spec.reads ?? {}));
  const visit = (node: LayoutJson) => {
    if (node.kind === "split") node.children.forEach(visit);
    else if (node.kind === "gate") { if (gateActive(node.when, page, spec.subject?.field)) visit(node.child); }
    else { const read = spec.panes[node.id]?.read ?? spec.core; if (read) active.add(read); }
  };
  visit(spec.layout);
  const subjectRead = spec.subject ? spec.subject.read ?? spec.core : undefined;
  if (subjectRead) active.add(subjectRead);
  return active;
}
export const split = (
  axis: "h" | "v",
  children: readonly (string | LayoutJson)[],
  options: Omit<Extract<LayoutJson, { kind: "split" }>, "kind" | "axis" | "children">,
): LayoutJson => ({
  kind: "split",
  axis,
  ...options,
  children: children.map((child) =>
    typeof child === "string" ? { kind: "pane", id: child } : child,
  ),
});
export const field = <S extends z.ZodType, const R extends Field["role"]>(
  schema: S,
  initial: z.input<S>,
  role: R,
  url: Field["url"] = "replace",
) => ({ schema, initial, role, url });
/**
 * The kernel's picture pose as Page fields (ADR 0035 rule 1). Each default is the contract schema's own
 * (`picturePoseSchemas`): nothing here states one. `route()` puts `picturePose` on the Page of every route
 * that declares `picture`; a route spreads it into `fields` only to read the pose in its own typed context.
 */
export const poseFields = (s: typeof picturePoseSchemas) => ({
  contextRadiusFt: field(s.contextRadiusFt, s.contextRadiusFt.parse(undefined), "pose", "replace"),
  sceneView: field(s.sceneView, s.sceneView.parse(undefined), "pose", "replace"),
  viewport: field(s.viewport, s.viewport.parse(undefined), "pose", "replace"),
  context: field(s.context, s.context.parse(undefined), "pose", "push"),
  layers: field(s.layers, s.layers.parse(undefined), "pose", "push"),
  encoding: field(s.encoding, s.encoding.parse(undefined), "pose", "push"),
  picture: field(s.picture, s.picture.parse(undefined), "pose", "push"),
});
export const picturePose = poseFields(picturePoseSchemas);
/** The text keys of a subject set of plain refs (system name, workspace id); a tuple key, placement or sub is not a name and throws. */
export const namesOf = (value: Many<SubjectRefCode>): string[] | "all" =>
  value.kind === "all"
    ? "all"
    : value.ids.map((id) => {
        const { key, placement, sub } = subjectOf(id);
        if (typeof key !== "string" || placement !== undefined || sub !== undefined)
          throw Error(`namesOf: ${id} is not a plain text-keyed subject`);
        return key;
      });
export { subjectSchema };
export type Fields = Readonly<Record<string, Field>>;
/** Route-owned Page fields no slot holds (ADR 0035 rule 1). */
export type QueryFields = Readonly<Record<string, Field & { role: "query" }>>;
type FieldValues<F extends Fields> = {
  readonly [K in keyof F]: Immutable<z.output<F[K]["schema"]>>;
};
export type Page<F extends Fields> = FieldValues<F> & {
  readonly selected: readonly { kind: "focus"; id: string }[];
};
type RoleFields<F extends Fields, R extends Field["role"]> = {
  [K in keyof F]: R extends F[K]["role"] ? K : never;
}[keyof F];
export type DrawPage<F extends Fields> = {
  read(): Page<F>;
  pose(
    patch: Partial<Pick<FieldValues<F>, RoleFields<F, "pose" | "stage">>>,
    intent?: "gesture" | "named",
  ): unknown;
  query(patch: Partial<Pick<FieldValues<F>, RoleFields<F, "query">>>): unknown;
  select(value: Page<F>["selected"]): unknown;
};
/** A value-less reading state: reading, refused, or not yet run. */
export type Absent = Exclude<ReadingState<unknown>, { value: unknown }>;
/** The value a reading state holds; undefined when it is value-less. */
export const valueOf = <T>(state: ReadingState<T> | undefined): Immutable<T> | undefined =>
  state && "value" in state ? state.value : undefined;
/** The shell's words for a reading or Work state that is not ready. */
export const reasonOf = (state: ReadingState<unknown>): string =>
  "reason" in state && state.reason ? state.reason : state.state === "not-yet-run" ? "Start this Work to edit" : "Reading...";
/** Why a reading or Work state is not ready; null when it is. */
export const refusalOf = (state: ReadingState<unknown>): string | null => state.state === "ready" ? null : reasonOf(state);
export type EditHistory = { label: string; [key: string]: unknown };
export type EditFailure = { code: string; message: string } | null;
export type CellFacts = Pick<import("@pe/kit/lang/cell").HandleCellProps, "model" | "source" | "options" | "parse" | "format"> & { baseline?: unknown; readOnly?: boolean };
export interface OwnedCell {
  readonly facts: CellFacts;
  readonly freshness: "current" | "stale" | "never";
  accept(history?: EditHistory): Promise<EditFailure>;
  deny(history?: EditHistory): Promise<EditFailure>;
  readonly owner: { route: string; label: string };
  readonly value: import("@pe/agent-contracts").CellLike;
  readonly refusal: string | null;
  transitions(history?: EditHistory): import("@pe/kit/lang/cell").CellTransition[];
  stage(value: unknown, history?: EditHistory): Promise<EditFailure>;
  clear(history?: EditHistory): Promise<EditFailure>;
  delete(history?: EditHistory): Promise<EditFailure>;
}
export interface EditableCells<W, Edit> {
  readonly doc: Immutable<W> | null;
  readonly basis: InvocationToken | null;
  /** Work readiness as one reading state: `ready` is editable, absent Work is `not-yet-run`. */
  readonly state: ReadingState<W>;
  owner(path: readonly string[]): { route: string; label: string };
  at(path: readonly [string, ...string[]], owner?: string, facts?: CellFacts): OwnedCell;
  label(input: Edit, label: string): string;
  edit(input: Edit, history?: EditHistory): Promise<EditFailure>;
  /** Mixed claim edits still use multiple paths; retire with their drawing adapters in wave 4. */
  patch(patches: readonly RouteStatePatch[], history?: EditHistory): Promise<EditFailure>;
}
export type PaneBindings = {
  selected?: readonly import("@pe/kit/lang/attention").SubjectKey[];
  members?: import("@pe/kit/lang/attention").Members;
  observation?: import("../revit/observation").NativeObservation;
};
export interface DrawContext<D, F extends Fields, W, Edit, V extends AnyVerbs = AnyVerbs> {
  readonly target: import("@pe/agent-contracts").ExecutionTarget | null;
  /** A second reading; the body narrows on `"value" in` and draws `absent(state)` otherwise. */
  read<R extends HostRead>(read: R): ReadingState<ReadData<R>>;
  /** The pane's own read, always present: the shell draws reading, refused and not-yet-run before `draw` runs. */
  readonly value: Present<D> & { readonly publication: Immutable<Publication<D>["value"]> };
  /** The shell's one line for a value-less state. */
  absent(state: Absent): import("react").ReactNode;
  readonly page: DrawPage<F>;
  readonly selection: { read(): Page<F>["selected"]; set(value: Page<F>["selected"]): unknown };
  readonly cells: EditableCells<W, Edit>;
  refresh(read?: HostRead): void;
  /** A verb this route declared, or one of the kernel's. A property, not a method: an id the route
   *  did not declare fails `tsc` where the route names the body that asks for it. */
  readonly verb: <K extends keyof (V & KernelVerbs)>(id: K) => (V & KernelVerbs)[K];
}
/** What every verb says of itself, whichever door it goes through. */
export interface VerbFacts {
  readonly label: string;
  readonly effect: Effect;
  readonly pending: boolean;
  readonly refusal: string | null;
  readonly failure: string | null;
}
/** A verb whose handle has no plan: one press, one send. */
export interface RunVerb extends VerbFacts {
  run(input?: unknown): Promise<unknown>;
}
/** A verb whose handle has a plan: it is reviewed, so it has no `run`. */
export interface PlannedVerb extends VerbFacts, importPlanHandle {
  readonly pending: boolean;
  readonly refusal: string | null;
  readonly failure: string | null;
  plan(input?: unknown): Promise<unknown>;
  apply(): Promise<unknown>;
}
export type VerbHandle = RunVerb | PlannedVerb;
type KernelVerbs = Readonly<Record<KernelVerbKey, RunVerb>>;
/** A body's verbs, named apart from the route declaration (`ContextOf`): the ids it runs, the ids it plans. */
export type Verbs<Run extends string = never, Plan extends string = never> = Readonly<Record<Run, RunVerb>> &
  Readonly<Record<Plan, PlannedVerb>>;
type AnyVerbs = Readonly<Record<string, VerbHandle>>;
type VerbScope = { page: unknown; value: unknown; doc: unknown };
/** What a verb's `input` and `present` see: the Page, the target, the route's own Work and core Value. */
export type VerbContext<C extends VerbScope = { page: any; value: any; doc: any }> = {
  readonly page: C["page"];
  readonly target: import("@pe/agent-contracts").ExecutionTarget | null;
  readonly work: import("@pe/agent-contracts").WorkHandle | null;
  readonly value: C["value"] | undefined;
  readonly doc: C["doc"] | undefined;
};
/** What a review says: one sentence, or a sentence over its rows and cells (`presentationSchema` decodes it). */
type Presentation = string | { readonly sentence: string; readonly rows: readonly string[]; readonly cells?: readonly unknown[] };
/** The mount binds the Work handles; a verb supplies the rest of its handle's input. */
type Unbound<I> = I extends object ? Omit<I, "work" | "readWorks"> : I;
/**
 * A verb: a command handle placed on a route (ADR 0042). Its plan decides whether it is reviewed, so a
 * handle with a plan must say how its review reads; its effect decides which door it goes through.
 * Without `input`, what the press supplies is the input.
 */
export type VerbDecl<C extends VerbScope, H extends CommandHandle = CommandHandle> = {
  readonly handle: H;
  readonly label: string;
  readonly input?: (ctx: VerbContext<C>, supplied?: any) => Unbound<InputOf<H>>;
} & (CommandHandle extends H
  // A handle whose key is erased (a mounted spec declared again) keeps whatever it had.
  ? { present?(result: unknown, ctx: VerbContext<C> & { readonly value: C["value"]; readonly doc: C["doc"] }): Presentation }
  : H extends { plan: object }
    ? { present(result: unknown, ctx: VerbContext<C> & { readonly value: C["value"]; readonly doc: C["doc"] }): Presentation }
    : { present?: never });
/** A declared verb as the shell holds it, whatever its handle. */
export type AnyVerb = {
  readonly handle: CommandHandle;
  readonly label: string;
  input?(ctx: VerbContext, supplied?: unknown): unknown;
  present?(result: unknown, ctx: VerbContext): Presentation;
};
type HandlesOf<V> = { readonly [K in keyof V]: V[K] extends { plan: object } ? PlannedVerb : RunVerb };

type Owner = { state: RouteStateSpec<z.ZodObject>; value?: string };
export type Owners = Readonly<Record<string, Owner>>;
type HostRead = import("./host-read.ts").HostRead;
export type ReadData<R extends HostRead> = NonNullable<z.output<R["output"]>["value"]>["data"];
/** Layout is data (ADR 0035 rule 5, `route/body.ts`): a pane declares its body kind and `draw`
 * returns that kind's branded `Body`, so the declaration and the drawing cannot disagree. */
type PaneBody<C> = { [B in BodyKind]: { body: B; draw(ctx: C): Body<B> } }[BodyKind];
export type Specification<
  D,
  F extends Fields,
  W extends z.ZodObject,
  Edit extends z.ZodType,
  Reads extends Readonly<Record<string, HostRead>> = Readonly<Record<string, HostRead>>,
  SubjectRead extends HostRead = HostRead,
  Q extends QueryFields = {},
  V extends Readonly<Record<string, CommandHandle>> = Readonly<Record<string, CommandHandle>>,
> = {
  key: string;
  /** Saved Page vocabulary that this product explicitly retired, without aliases. */
  retiredPage?: { readonly fields?: readonly string[]; readonly values?: Readonly<Record<string, readonly string[]>> };
  address?: string;
  name: string;
  /** Person-only surfaces opt out of both builtin and admitted Page leases. */
  agent?: false;
  directory: RouteGraphJson["directory"];
  needs?: "project" | "family" | "document" | "host" | "browser";
  optionalTarget?: "document" | "project" | "family" | "session";
  /** `./host.ts`, the route directory's reads; only the generated host registry imports it. */
  host?: string;
  subject?: {
    field: RoleFields<F & NoInfer<Q>,"subject"> & string;
    noun: string;
    multiple?: boolean;
    pane: string;
    read?: SubjectRead;
    options(data: Immutable<ReadData<SubjectRead>>): readonly { id: SubjectRefCode; label: string }[];
  };
  core?: HostRead & { output: z.ZodType<Publication<D>>; args(page: Page<F & NoInfer<Q>>): unknown };
  /*
   * ADR 0035 rule 1: the five slots are `subject` (above), `sheet`, `picture`, `goal` and `layout`
   * (below), plus `query` and `title(ctx)`. Types are inferred from the declaration, never
   * generated (rule 4). The kernel seams that fill each slot live in `./slots/<slot>/`; until a
   * slice lands, a seam throws `not implemented: slice N`. `fields` stands until slice 10 moves the
   * subject into `subject`, the pose into `picture` and the rest into `query`.
   */
  /** Slice 7: bindings by cell name, three closed kinds; the kernel draws a StateCell per binding per row. */
  sheet?: SheetSlot;
  /** Slice 8: a scope (SubjectRef set, box, or prism with a frame) and marks from the closed set; the kernel draws
   * them in its picture pane. `overlay` is the one hook for what the closed marks cannot express: a builtin
   * loads it with `overlay()` (`slots/picture/overlay.tsx`, which types its parts); a Pod declares none. */
  picture?: PictureSlot<DrawContext<NoInfer<D>, NoInfer<F & NoInfer<Q>>, z.output<W>, z.output<Edit>, HandlesOf<NoInfer<V>>>> & {
    overlay?(props: { ctx: DrawContext<NoInfer<D>, NoInfer<F & NoInfer<Q>>, z.output<W>, z.output<Edit>, HandlesOf<NoInfer<V>>>; scope: PictureScope; picture(parts: any): any }): unknown;
  };
  /** Slice 7: one host Read whose data is the Goal; the kernel draws its unresolved list first. */
  goal?: HostRead & { output: z.ZodType<Publication<Goal>>; args(page: Page<NoInfer<F & NoInfer<Q>>>): unknown };
  /** Route-owned Page fields no slot holds; folded into `fields` for projection until slice 10 retires `fields`. */
  query?: Q;
  /** The pane head's title (ADR 0035 rule 5): the kernel draws it in the head of the first pane, in layout
   * order, that is not the subject list. Null draws nothing. */
  title?(ctx: DrawContext<NoInfer<D>, NoInfer<F & NoInfer<Q>>, z.output<W>, z.output<Edit>, HandlesOf<NoInfer<V>>>): string | null;
  fields: F;
  reads?: Readonly<Record<string, HostRead & { args(page: Page<F & NoInfer<Q>>): unknown }>>;
  panes: {
    readonly [K in keyof Reads]: {
      title: string;
      purpose: string;
      subjectList?: true;
      /** A pane the shell draws from a filled slot (`typed-shell.tsx`); the route names and places it, and its `draw` is unused. */
      kernel?: "sheet" | "goal" | "picture";
      /** The pane's ground (kit `Pane`): `artifact` lets support heads inside it recede (L4). */
      ground?: "artifact";
      read?: Reads[K];
      /** The verbs this pane's body draws. A verb is on the band or in exactly one pane. */
      verbs?: readonly (keyof NoInfer<V> & string)[];
      bindings?(ctx: DrawContext<ReadData<Reads[K]>, F & NoInfer<Q>, z.output<W>, z.output<Edit>, HandlesOf<NoInfer<V>>>): PaneBindings;
    } & PaneBody<DrawContext<ReadData<Reads[K]>, F & NoInfer<Q>, z.output<W>, z.output<Edit>, HandlesOf<NoInfer<V>>>>;
  };
  edits?: {
    work: W | RouteStateSpec<W>;
    key?(page: Page<F & NoInfer<Q>>): string | null;
    seed?(page: Page<F & NoInfer<Q>>, target: import("@pe/agent-contracts").ExecutionTarget | null): z.output<W>;
    value?: keyof D & string;
    owners: Owners;
    input: Edit;
    patches(input: z.output<Edit>, data: Immutable<D>): readonly RouteStatePatch[];
    history: z.ZodType;
    describe(history: any): { label: string; meta?: unknown };
  };
  /** Keyed by verb id, which is not the catalog key: two verbs may share one handle. */
  verbs?: { readonly [K in keyof V]: VerbDecl<{ page: Page<F & NoInfer<Q>>; value: Immutable<D>; doc: Immutable<z.output<W>> }, V[K]> };
  /** The verbs the shell draws on the band, the first primary. */
  band?: readonly (keyof NoInfer<V> & string)[];
  layout: LayoutJson;
};
/** The shell executes this typed module. Data is a one-way discovery/host admission projection. */
export function route<D, const F extends Fields, W extends z.ZodObject, Edit extends z.ZodType,
  const Reads extends Readonly<Record<string, HostRead>>, SubjectRead extends HostRead, const Q extends QueryFields = {},
  const V extends Readonly<Record<string, CommandHandle>> = {}>(spec: Specification<D, F, W, Edit, Reads, SubjectRead, Q, V>) {
  const edits = spec.edits;
  const declared = edits?.work;
  const work = !declared ? undefined : "schema" in declared ? declared : { route: spec.key, title: spec.name,
    description: declared.description ?? spec.directory.summary, schema: declared, schemaVersion: 1, };
  const owners = work && edits ? { ...edits.owners, [work.route]: {state:work,value:edits.value} } : {};
  const sheet = spec.sheet ? sheetSlotData(spec.sheet) : undefined;
  // ADR 0035 rules 2, 3 and 8: a filled sheet, goal or picture slot is a kernel-drawn pane and, for a sheet that writes Revit,
  // the one sheet pair as the route's `sheet` verb. A route that declares either itself keeps its own.
  const declaredVerbs: Readonly<Record<string, AnyVerb>> = spec.verbs ?? {};
  const sheetVerb: Readonly<Record<string, AnyVerb>> = sheet && writesRevit(sheet) && !Object.values(declaredVerbs).some((verb) => verb.handle.key === SHEET_COMMANDS.apply)
    ? { sheet: { handle: handle(SHEET_COMMANDS.apply), label: "Write to Revit",
        present: (result: unknown) => {
          const writes = typeof result === "object" && result !== null && "writes" in result && Array.isArray(result.writes) ? result.writes.length : 0;
          return `Write ${writes} parameter value${writes === 1 ? "" : "s"} to Revit`;
        } } }
    : {};
  // Drawn once: a verb is on the band or in exactly one pane. The kernel's sheet verb is the band's.
  const band: readonly string[] = [...(spec.band ?? []), ...Object.keys(sheetVerb)];
  const placed = [...band, ...Object.values(spec.panes).flatMap((pane) => pane.verbs ?? [])];
  const verbTable: Readonly<Record<string, AnyVerb>> = { ...declaredVerbs, ...sheetVerb };
  for (const id of placed) if (!Object.hasOwn(verbTable, id)) throw Error(`Route ${spec.key}: "${id}" is placed but is not a declared verb`);
  for (const id of Object.keys(verbTable)) {
    const places = placed.filter((at) => at === id).length;
    if (places !== 1) throw Error(`Route ${spec.key}: verb "${id}" is ${places ? "placed more than once" : "in neither the band nor a pane"}; place it in the band or in exactly one pane`);
  }
  // The shell draws a kernel pane (`typed-shell.tsx`, `kernel`): a route module, and a Pod bundle, carries no React.
  // The sheet pane reads the core, as a declared pane does by default (`defaults.ts`): its cells and empty state take that read.
  const kernelPanes = {
    ...(spec.sheet && !Object.values(spec.panes).some((p) => p.kernel === "sheet") ? { sheet: { title: "Sheet", purpose: "Edit the bound cells", read: spec.core, kernel: "sheet", body: "scroll", draw: () => scrollBody(null) } } : {}),
    ...(spec.goal && !("goal" in spec.panes) ? { goal: { title: "Unresolved", purpose: "What is left before the answer", read: spec.goal,
      kernel: "goal", body: "scroll", draw: () => scrollBody(null) } } : {}),
    // The picture fills its pane and reads the core, whose evaluation is the capture's revision.
    ...(spec.picture && !Object.values(spec.panes).some((p) => p.kernel === "picture") ? { picture: { title: "Picture", purpose: "See the subject in the model", read: spec.core,
      kernel: "picture", body: "fill", draw: () => fillBody(null) } } : {}),
  } as unknown as Specification<D, F, W, Edit, Reads, SubjectRead, Q, V>["panes"];
  // The pose is the kernel's: a declared picture brings its fields, so the pane the kernel adds can draw for a
  // route that named none. A route's own field under a pose name would be drawn as the pose, so it is refused.
  const own: Fields = { ...spec.query, ...spec.fields };
  const pose: Fields = spec.picture ? picturePose : {};
  const clash = Object.keys(pose).find((key) => own[key] && own[key] !== pose[key]);
  if (clash) throw Error(`Route ${spec.key}: field "${clash}" is the picture's pose; spread picturePose or rename it`);
  const pageFields = { ...pose, ...own };
  // `query` fields mount as Page fields: the shell reads one field table (rule 1: `query` holds what no slot does).
  const normalized = { ...spec, fields: pageFields as F & Q, needs: spec.needs ?? "project", verbs: verbTable, band,
    panes: { ...spec.panes, ...kernelPanes }, edits: work && edits ? {...edits,work,owners} : undefined };
  const schemas: Record<string,z.ZodType> = { none:z.strictObject({}) };
  if (work && edits) {
    schemas.work=work.schema;
    schemas.historyDetail=edits.history instanceof z.ZodObject ? edits.history.omit({label:true}) : edits.history;
  }
  const fields: Record<string,RouteGraphJson["fields"][string]> = {};
  const fieldSchemas: Record<string,string> = {};
  for (const [key,field] of Object.entries(pageFields)) {
    let schema=key;
    while(Object.hasOwn(schemas,schema)) schema=`page:${schema}`;
    fieldSchemas[key]=schema;
    schemas[schema]=field.schema;
    fields[key]={role:field.role === "subject" ? "query" : field.role,schema,codec:key,
      ...(field.initial === undefined ? {} : {initial:field.initial}),url:field.url,share:field.share !== false,agent:spec.agent === false ? "none" : "set"};
  }
  const readIds = new Map<HostRead,string>();
  if(spec.core) readIds.set(spec.core,"value");
  if(spec.goal && !readIds.has(spec.goal)) readIds.set(spec.goal,"goal");
  for(const [id,read] of Object.entries(spec.reads ?? {})) if(!readIds.has(read)) readIds.set(read,id);
  for(const [id,pane] of Object.entries(normalized.panes)) if(pane.read&&!readIds.has(pane.read)) readIds.set(pane.read,id);
  const subjectRead=spec.subject ? readIds.get(spec.subject.read ?? spec.core!) : undefined;
  if(spec.subject && !subjectRead) throw Error("Subject read must be declared by the route");
  if(spec.subject) fields[spec.subject.field]={...fields[spec.subject.field],role:"subject",schema:fieldSchemas[spec.subject.field]!,
    codec:spec.subject.field,initial:spec.fields[spec.subject.field]!.initial,url:"push",share:true,agent:spec.agent === false ? "none" : "set",
    cardinality:"many",picker:{reading:subjectRead!,options:"subject"}};
  fields.selected={role:"selection",kinds:["focus"]};
  const readings: Record<string,RouteGraphJson["readings"][string]>={};
  for(const [read,id] of readIds) readings[id]={kind:"use",entry:read.key,demand:"visible",
    retain:{evidence:"scope",resource:"scope"},refresh:"dependencies",deps:{page:Object.keys(fields),work:[],readings:[]}};
  const verbs:RouteGraphJson["verbs"]=Object.fromEntries(Object.entries(verbTable).map(([id,verb])=>[id,{
    entry:verb.handle.key,label:verb.label,effect:verb.handle.effect,review:verb.handle.plan?"shown":"none",
  }]));
  const data:RouteGraphJson={version:1,key:spec.key,address:spec.address ?? `/${spec.key}`,name:spec.name,directory:spec.directory,
    capabilities:[...(work?["work" as const]:[]),...(Object.keys(verbs).length?["native-write" as const]:[]),
      ...(["document","project","family"].includes(normalized.needs)?["geometry" as const]:[])],fields,
    ...(spec.subject?{subject:{field:spec.subject.field,noun:spec.subject.noun,pane:spec.subject.pane,roster:subjectRead!,detail:subjectRead!}}:{}),
    ...(work?{historyDetail:"historyDetail",work:{schema:"work",route:work.route,version:work.schemaVersion??1,}}:{}),
    workFields:Object.fromEntries(Object.entries(work?.schema.shape ?? {}).flatMap(([key,schema])=>{
      const meta=(schema as z.ZodType).meta();
      return meta?.title ? [[key,{label:meta.title,internal:meta.internal === true}]] : [];
    })),cells:{},panes:Object.fromEntries(Object.entries(normalized.panes).map(([id,p])=>[id,{label:p.title,purpose:p.purpose,
      draws:p.read?[readIds.get(p.read)!]:[],verbs:[...(p.verbs ?? [])]}])),band:[...band],readings,verbs,seeds:{},layout:spec.layout,
    ...(sheet?{sheet}:{}),...(spec.picture?{picture:pictureSlotData(spec.picture)}:{}),...(spec.goal?{goal:readIds.get(spec.goal)!}:{}),
    needs:normalized.needs === "browser" || normalized.needs === "host" ? "nothing" : normalized.needs,
    observe:[],resetOnTarget:[]};
  const gateErrors = linkRouteGates(data, schemas);
  if (gateErrors.length) throw Error(gateErrors.map(error => `${error.path}: ${error.message}`).join("; "));
  const host:HostRouteModule={data,schemas,...(work?{workState:work}:{})};
  const axes: Readonly<Record<string, EntryContract["axes"]>> = commandCatalogAxes;
  const entries:Record<string,EntryContract>=Object.fromEntries([...[...readIds.keys()].map(read=>[read.key,read]),
    // The linker finds a verb's entry by key; its axes are the generated table's, and no schema rides along.
    ...Object.values(verbTable).flatMap(verb=>[verb.handle,...(verb.handle.plan?[verb.handle.plan]:[])])
      .map(h=>{
        const declared = axes[h.key];
        if (!declared) throw Error(`No generated axes for ${h.key}`);
        return [h.key,{input:z.looseObject({}),output:z.unknown(),axes:declared}];
      })]);
  return {spec:normalized,data,host,entries};
}
export type TypedRoute = ReturnType<typeof route<any, Fields, z.ZodObject, z.ZodType, Record<string, HostRead>, HostRead, {}, Readonly<Record<string, CommandHandle>>>>;
