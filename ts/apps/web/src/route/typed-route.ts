import { z } from "zod";
import {
  identityCodecs,
  commands,
  commandCatalogAxes,
  type HostRouteModule,
  type Immutable,
  type RouteGraphJson,
  type RouteStatePatch,
  salvageWork,
  type RouteStateSpec,
  type ReadingSnapshot,
  type LayoutJson,
  type InvocationToken,
  type IdentityId,
  type EntryContract,
  type WorkHistoryPort,
  type Many,
} from "@pe/agent-contracts";
import type { Publication } from "./host-read.ts";

type Field = {
  schema: z.ZodType;
  initial: unknown;
  role: "pose" | "query" | "subject" | "stage";
  url: "push" | "replace";
};
export const whenSubject = (child: string | LayoutJson): LayoutJson => ({
  kind: "gate", when: "subject", child: typeof child === "string" ? { kind: "pane", id: child } : child,
});
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
export const localId = (namespace: string, subject: string) => {
  const id = identityCodecs.local.encode({ namespace, subject });
  if (!id.ok) throw Error(id.reason);
  return id.value;
};
export const namesOf = (value: Many<IdentityId<"local">>): string[] | "all" =>
  value.kind === "all" ? "all" : value.ids.map((id) => identityCodecs.local.parts(id).subject);
export { subjectSchema } from "@pe/agent-contracts";
type ResultCommand = {
  [K in keyof typeof commands]: (typeof commands)[K] extends { result: z.ZodType } ? K : never;
}[keyof typeof commands];
export const commandContract = <K extends ResultCommand & keyof typeof commandCatalogAxes>(
  key: K,
) => ({ input: commands[key].input, output: commands[key].result, axes: commandCatalogAxes[key] });
type WriteCommand = {
  [K in keyof typeof commands]: (typeof commands)[K] extends { writeBoundary: { phase: "apply" } }
    ? K
    : never;
}[keyof typeof commands];
export const command = <K extends WriteCommand & keyof typeof commandCatalogAxes>(key: K) => {
  const plan = commands[key].writeBoundary.previewKey;
  if (!Object.hasOwn(commands, plan) || !Object.hasOwn(commandCatalogAxes, plan))
    throw Error(`Missing plan contract for ${key}`);
  return {
    entry: key,
    plan,
    contract: commandContract(key),
    planContract: commandContract(plan as ResultCommand & keyof typeof commandCatalogAxes),
  };
};
export type Fields = Readonly<Record<string, Field>>;
type FieldValues<F extends Fields> = {
  readonly [K in keyof F]: Immutable<z.output<F[K]["schema"]>>;
};
export type Page<F extends Fields> = FieldValues<F> & {
  readonly selected: readonly { kind: "focus"; id: IdentityId<"local"> }[];
};
type RoleFields<F extends Fields, R extends Field["role"]> = {
  [K in keyof F]: F[K]["role"] extends R ? K : never;
}[keyof F];
export type DrawPage<F extends Fields> = {
  read(): Page<F>;
  pose(
    patch: Partial<Pick<FieldValues<F>, RoleFields<F, "pose">>>,
    intent?: "gesture" | "named",
  ): unknown;
  query(patch: Partial<Pick<FieldValues<F>, RoleFields<F, "query">>>): unknown;
  select(value: Page<F>["selected"]): unknown;
};
export type EditHistory = { label: string; [key: string]: unknown };
export type EditFailure = { code: string; message: string } | null;
export interface OwnedCell {
  readonly owner: { route: string; label: string };
  readonly value: import("@pe/agent-contracts").CellLike;
  readonly refusal: string | null;
  transitions(history?: EditHistory): import("@pe/kit/lang/cell").CellTransition[];
  stage(value: unknown, history?: EditHistory): Promise<EditFailure>;
  clear(history?: EditHistory): Promise<EditFailure>;
}
export interface EditableCells<W, Edit> {
  readonly doc: Immutable<W> | null;
  readonly basis: InvocationToken | null;
  readonly ready: boolean;
  readonly refusal: string | null;
  readonly history: WorkHistoryPort<any>;
  owner(path: readonly string[]): { route: string; label: string };
  at(path: readonly [string, ...string[]], owner?: string): OwnedCell;
  label(input: Edit, label: string): string;
  edit(input: Edit, history?: EditHistory): Promise<EditFailure>;
  /** Mixed claim edits still use multiple paths; retire with their drawing adapters in wave 4. */
  patch(patches: readonly RouteStatePatch[], history?: EditHistory): Promise<EditFailure>;
}
export interface DrawContext<D, F extends Fields, W, Edit> {
  readonly target: import("@pe/agent-contracts").ExecutionTarget | null;
  read<R extends HostRead>(read: R): ReadingSnapshot<ReadData<R>>;
  readonly value: ReadingSnapshot<D> & { readonly publication: Immutable<Publication<D>["value"]> };
  readonly page: DrawPage<F>;
  readonly selection: { read(): Page<F>["selected"]; set(value: Page<F>["selected"]): unknown };
  readonly cells: EditableCells<W, Edit>;
  write(command: string): { plan(): unknown; apply(): unknown; cancel(): unknown; read(): unknown };
}
type Owner = { state: RouteStateSpec<z.ZodObject>; value: string };
export type Owners = Readonly<Record<string, Owner>>;
type HostRead = import("./host-read.ts").HostRead;
export type ReadData<R extends HostRead> = NonNullable<z.output<R["output"]>["value"]>["data"];
export type Specification<
  D,
  F extends Fields,
  W extends z.ZodObject,
  Edit extends z.ZodType,
  Reads extends Readonly<Record<string, HostRead>> = Readonly<Record<string, HostRead>>,
  SubjectRead extends HostRead = HostRead,
> = {
  key: string;
  name: string;
  directory: RouteGraphJson["directory"];
  subject: {
    field: keyof F & string;
    noun: string;
    pane: string;
    read?: SubjectRead;
    options(data: Immutable<ReadData<SubjectRead>>): readonly { id: IdentityId<"local">; label: string }[];
  };
  core: HostRead & { output: z.ZodType<Publication<D>>; args(page: Page<F>): unknown };
  fields: F;
  reads?: Readonly<Record<string, HostRead & { args(page: Page<F>): unknown }>>;
  panes: {
    readonly [K in keyof Reads]: {
      title: string;
      purpose: string;
      read: Reads[K];
      draw(ctx: DrawContext<ReadData<Reads[K]>, F, z.output<W>, z.output<Edit>>): unknown;
    };
  };
  edits: {
    work: W | RouteStateSpec<W>;
    value: keyof D & string;
    owners: Owners;
    input: Edit;
    patches(input: z.output<Edit>, data: Immutable<D>): readonly RouteStatePatch[];
    history: z.ZodType;
    describe(history: any): { label: string; meta?: unknown };
  };
  commands: Readonly<
    Record<
      string,
      {
        entry: string;
        plan: string;
        contract: EntryContract;
        planContract: EntryContract;
        label: string;
        present(result: unknown, data: Immutable<D>, work: Immutable<z.output<W>>): unknown;
      }
    >
  >;
  layout: LayoutJson;
};
/** The shell executes this typed module. Data is a one-way discovery/host admission projection. */
export function route<D, const F extends Fields, W extends z.ZodObject, Edit extends z.ZodType,
  const Reads extends Readonly<Record<string, HostRead>>, SubjectRead extends HostRead>(spec: Specification<D, F, W, Edit, Reads, SubjectRead>) {
  const declared = spec.edits.work;
  const work = "schema" in declared ? declared : { route: spec.key, title: spec.name, description: declared.description ?? spec.directory.summary,
    schema: declared, schemaVersion: 1, salvage: (raw:unknown) => salvageWork(declared,raw).doc };
  const schemas: Record<string, z.ZodType> = { work: work.schema,
    historyDetail: spec.edits.history instanceof z.ZodObject ? spec.edits.history.omit({ label: true }) : spec.edits.history };
  const fields: Record<string, RouteGraphJson["fields"][string]> = {};
  for (const [key, field] of Object.entries(spec.fields)) {
    schemas[key] = field.schema;
    fields[key] = { role: field.role === "subject" ? "query" : field.role, schema: key, codec: key,
      initial: field.initial, url: field.url, share: true, agent: "set" };
  }
  const readIds = new Map<HostRead,string>([[spec.core,"value"],...Object.entries(spec.reads ?? {}).map(([id,read]) => [read,id] as [HostRead,string])]);
  const subjectRead = spec.subject.read ? readIds.get(spec.subject.read) : "value";
  if (!subjectRead) throw Error("Subject read must be declared by the route");
  fields[spec.subject.field] = { ...fields[spec.subject.field], role: "subject", schema: spec.subject.field,
    codec: spec.subject.field, initial: spec.fields[spec.subject.field]!.initial, url: "push", share: true,
    agent: "set", cardinality: "many", identity: "subject", picker: { reading: subjectRead, options: "subject" } };
  fields.selected = { role: "selection", kinds: ["focus"] };
  const owners = { ...spec.edits.owners,
    [work.route]: { state: work, value: spec.edits.value } };
  const policy = { demand: "visible", retain: { evidence: "scope", resource: "scope" }, refresh: "dependencies" } as const;
  const readings: Record<string, RouteGraphJson["readings"][string]> = {
    value: { ...policy, kind: "use", entry: spec.core.key, deps: { page: Object.keys(fields), work: [], readings: [] } },
  };
  for (const [read,id] of readIds) readings[id] = { ...policy, kind: "use", entry: read.key, deps: {page:Object.keys(fields),work:[],readings:[]} };
  const verbs: RouteGraphJson["verbs"] = Object.fromEntries(Object.entries(spec.commands).map(([id, cmd]) => [id, {
    kind: "command", entry: cmd.entry, input: "none", label: cmd.label, review: "shown",
    deps: { page: [spec.subject.field], work: Object.keys(work.schema.shape), readings: ["value"] },
    captures: ["value"], intent: id,
  }]));
  const stage = String(Object.values(spec.fields).find(f => f.role === "stage")?.initial ?? "main");
  const data: RouteGraphJson = { version: 1, key: spec.key, address: `/${spec.key}`, name: spec.name,
    directory: spec.directory, capabilities: ["work", "native-write", "geometry"], fields,
    identities: { subject: { kind: "local", codec: "local" }, focus: { kind: "local", codec: "local" } },
    subject: { field: spec.subject.field, noun: spec.subject.noun, pane: spec.subject.pane, roster: subjectRead, detail: "value" }, historyDetail: "historyDetail",
    work: { schema: "work", route: work.route, version: work.schemaVersion ?? 1, migrations: {} },
    workFields: {}, cells: {}, panes: Object.fromEntries(Object.entries(spec.panes).map(([id,p]) => [id,
      { label: p.title, purpose: p.purpose, draws: ["value"], verbs: Object.keys(verbs) }])),
    readings, verbs, seeds: {}, layout: discoveryLayout(spec.layout), needs: "project", predicates: {}, observe: [],
    resetOnTarget: [], stageOrder: [stage], stages: { [stage]: { panes: Object.keys(spec.panes), verbs: Object.keys(verbs), word: spec.name } } };
  schemas.none = z.strictObject({});
  const host: HostRouteModule = { data, schemas, bodies: {}, workState: work, readWorks: Object.keys(owners).filter(id=>id!==work.route) };
  const entries: Record<string, EntryContract> = Object.fromEntries([...[...readIds.keys()].map(read=>[read.key,read]), ...Object.values(spec.commands).flatMap(c => [[c.entry,c.contract],[c.plan,c.planContract]])]);
  return { spec: { ...spec, edits: { ...spec.edits, work, owners } }, data, host, entries };
}
export type TypedRoute = ReturnType<typeof route<any, Fields, z.ZodObject, z.ZodType, Record<string, HostRead>, HostRead>>;

/** Data discovery has no executable predicate slots; the native shell owns subject gates. */
function discoveryLayout(node: LayoutJson): LayoutJson {
  return node.kind === "gate" ? discoveryLayout(node.child) : node.kind === "split" ? {...node,children:node.children.map(discoveryLayout)} : node;
}
export function projectValue<A,B>(reading: ReadingSnapshot<A>, select:(value:Immutable<A>)=>B): ReadingSnapshot<B> {
  return {...reading,...(reading.value === undefined ? {} : {value:select(reading.value)})} as ReadingSnapshot<B>;
}
