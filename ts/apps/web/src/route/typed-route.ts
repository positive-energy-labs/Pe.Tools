import { z } from "zod";
import {
  applyPatches, identityCodecs, jsonCodec, routeStatePatchSchema,
  type HostRouteModule, type Immutable,
  type RouteGraphJson, type RouteStatePatch,
  type RouteStateSpec, type ReadingSnapshot,
} from "@pe/agent-contracts";
import { canonicalEnvironmentInput } from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { LayoutJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type { PagePort, InvocationToken, IdentityId } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import type { EntryContract, WorkHistoryPort } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";

type Field = { schema: z.ZodType; initial: unknown; role: "pose" | "query" | "subject" | "stage"; url: "push" | "replace" };
export const field = <S extends z.ZodType, const R extends Field["role"]>(schema: S, initial: z.input<S>, role: R, url: Field["url"] = "replace") => ({ schema, initial, role, url });
type Fields = Readonly<Record<string, Field>>;
type FieldValues<F extends Fields> = { readonly [K in keyof F]: Immutable<z.output<F[K]["schema"]>> };
type Page<F extends Fields> = FieldValues<F> & { readonly selected: readonly { kind: "focus"; id: IdentityId<"local"> }[] };
type DrawPage<F extends Fields> = Omit<PagePort<RouteGraphJson, {}>, "read" | "pose" | "query" | "select"> & {
  read(): Page<F>;
  pose(patch: Partial<FieldValues<F>>, intent?: "gesture" | "named"): unknown;
  query(patch: Partial<FieldValues<F>>): unknown;
  select(value: Page<F>["selected"]): unknown;
};
export type EditHistory = { label: string; [key: string]: unknown };
export type EditFailure = { code: string; message: string } | null;
export interface EditableCells<W, Edit> {
  readonly doc: Immutable<W> | null;
  readonly basis: InvocationToken | null;
  readonly ready: boolean;
  readonly history: WorkHistoryPort<any>;
  owner(path: readonly string[]): { route: string; label: string };
  patch(patches: readonly RouteStatePatch[], history?: EditHistory): Promise<EditFailure>;
  edit(input: Edit, history?: EditHistory): Promise<EditFailure>;
}
export interface DrawContext<D, F extends Fields, W, Edit> {
  readonly value: ReadingSnapshot<D>;
  readonly page: DrawPage<F>;
  readonly cells: EditableCells<W, Edit>;
  readonly fixture: string | null;
}
type Owner = { state: RouteStateSpec<z.ZodObject>; value: string };
type Owners = Readonly<Record<string, Owner>>;
type HostRead = import("./host-read.ts").HostRead;
type MutableTable<T> = Record<string, T extends Readonly<Record<string, infer V>> ? V : never>;
type Graph<F extends Fields> = Omit<RouteGraphJson, "fields" | "work" | "identities"> & {
  fields: { [K in keyof F]: { role: F[K]["role"]; schema: K; codec: K; initial: unknown; url: "push" | "replace"; share: true; agent: "set" } & (F[K]["role"] extends "subject" ? { cardinality: "many"; identity: "subject"; picker: { reading: "value"; options: "pickSubject" } } : {}) } & { selected: { role: "selection"; kinds: readonly ["focus"] } };
  identities: { subject: { kind: "local"; codec: "local" }; focus: { kind: "local"; codec: "local" } };
  work: { schema: "work"; route: string; version: 1; migrations: {} };
};
type Schemas<F extends Fields, W extends z.ZodObject> = { [K in keyof F]: F[K]["schema"] } & { work: W };
type Specification<D, F extends Fields, W extends z.ZodObject, Edit extends z.ZodType> = {
  key: string; name: string; directory: RouteGraphJson["directory"];
  subject: { field: string; noun: string; schema: z.ZodType; namespace: string; pane: string; options(data: Immutable<D>): readonly { id: IdentityId<"local">; label: string }[] };
  core: HostRead & { args(page: Page<F>): unknown };
  fields: F;
  panes: Readonly<Record<string, { title: string; purpose: string; read: HostRead; draw(ctx: DrawContext<D, F, z.output<W>, z.output<Edit>>): unknown }>>;
  edits: { work: RouteStateSpec<W>; owners: Owners; input: Edit; patches(input: z.output<Edit>, data: Immutable<D>): readonly RouteStatePatch[]; history: z.ZodType; describe(history: any): { label: string; meta?: unknown } };
  commands: Readonly<Record<string, { entry: string; plan: string; contract: EntryContract; planContract: EntryContract; label: string; requires?: readonly string[]; present(result: unknown, data: Immutable<D>, work: Immutable<z.output<W>>): unknown }>>;
  layout: LayoutJson;
};
// The projection is executable kernel output. Routes never author slot ids, deps, codecs or gates.
export function route<D, const F extends Fields, W extends z.ZodObject, Edit extends z.ZodType>(spec: Specification<D, F, W, Edit>) {
  const schemas: Record<string, z.ZodType> = { none: z.strictObject({}), work: spec.edits.work.schema, historyDetail: spec.edits.history instanceof z.ZodObject ? spec.edits.history.omit({ label: true }) : spec.edits.history };
  const bodies: Record<string, { slot: string; kind: string; source: { module: string; export: string }; run: (...args: any[]) => any }> = {};
  const source = { module: "route/typed-route.ts", export: "route" };
  const body = (id: string, slot: string, kind: string, run: (...args: any[]) => any) => { bodies[id] = { slot, kind, source, run }; return id; };
  const fields: MutableTable<RouteGraphJson["fields"]> = {};
  const codecs: Record<string, ReturnType<typeof jsonCodec>> = {};
  for (const [key, value] of Object.entries(spec.fields)) {
    schemas[key] = value.schema; codecs[key] = jsonCodec(value.schema);
    fields[key] = { role: value.role === "subject" ? "query" : value.role, schema: key, codec: key, initial: value.initial, url: value.url, share: true, agent: "set" };
  }
  schemas[spec.subject.field] = spec.subject.schema;
  codecs[spec.subject.field] = jsonCodec(spec.subject.schema);
  fields[spec.subject.field] = { role: "subject", schema: spec.subject.field, codec: spec.subject.field, initial: { kind: "ids", ids: [] }, url: "push", share: true, agent: "set", cardinality: "many", identity: "subject", picker: { reading: "value", options: "pickSubject" } };
  fields.selected = { role: "selection", kinds: ["focus"] };
  const mode = String(Object.values(spec.fields).find((field) => field.role === "stage")?.initial ?? "main");
  const empty = { page: [], work: [], readings: [] };
  const policy = { demand: "visible", retain: { evidence: "scope", resource: "scope" }, refresh: "dependencies" } as const;
  const entries: Record<string, EntryContract> = {};
  const readings: MutableTable<RouteGraphJson["readings"]> = {};
  const sources: Record<string, HostRead["source"]> = {};
  const addRead = (id: string, read: HostRead) => {
    entries[read.key] = read; sources[read.key] = read.source;
    readings[id] = { ...policy, kind: "use", entry: read.key, args: body(`${id}Args`, `readings.${id}.args`, "args", (ctx) => spec.core.args(ctx.page)), deps: { page: Object.keys(fields), work: [], readings: [] } };
  };
  addRead("value", spec.core);
  body("pickSubject", `fields.${spec.subject.field}.picker.options`, "picker", (reading) => reading.value?.value?.data ? spec.subject.options(reading.value.value.data) : []);
  const own = spec.edits.work.route;
  const owners: Owners = { ...spec.edits.owners, [own]: { state: spec.edits.work, value: spec.edits.owners[own]?.value ?? "work" } };
  const workKeys = Object.keys(spec.edits.work.schema.shape);
  const verbs: MutableTable<RouteGraphJson["verbs"]> = {};
  schemas.patch = z.object({ patches: z.array(routeStatePatchSchema), history: spec.edits.history.optional() });
  const cells: MutableTable<RouteGraphJson["cells"]> = {}, workFields: MutableTable<NonNullable<RouteGraphJson["workFields"]>> = {};
  // Cell metadata derives from the same Work schema; record cells and scalar cells have one path.
  for (const key of workKeys) {
    let schema: any = spec.edits.work.schema.shape[key];
    while (schema.unwrap) schema = schema.unwrap();
    if (schema instanceof z.ZodRecord || schema?.shape?.edit) {
      schemas[`${key}Cell`] = schema instanceof z.ZodRecord ? schema.valueType : schema;
      cells[key] = { segment: schema instanceof z.ZodRecord ? key : null, value: `${key}Cell`, groupOf: body(`group${key}`, `cells.${key}.groupOf`, "group", (key) => [key]), deps: empty };
    } else workFields[key] = { label: key, internal: true };
  }
  for (const [owner, config] of Object.entries(owners)) {
    const reading = `owner:${owner}`;
    if (owner !== own) {
      schemas[reading] = config.state.schema;
      readings[reading] = { ...policy, kind: "work", route: owner, output: reading, deps: empty };
    }
    const id = owner === own ? "edit" : `edit:${owner}`;
    verbs[id] = {
      kind: "work", input: "patch", label: "Edit", review: "none", captures: [],
      deps: { page: [], work: owner === own ? workKeys : [], readings: ["value", ...(owner === own ? [] : [reading])] },
      ...(owner === own ? {} : { target: reading }),
      patches: body(`${id}Patches`, `verbs.${id}.patches`, "work", (ctx, input) => {
        const doc = owner === own ? ctx.work : ctx.readings[reading].value;
        const applied = applyPatches(config.state, { version: 1, revision: 0, doc }, "human", input.patches, 0, false, true);
        if (!applied.ok) throw Error(applied.error);
        return [...new Set<string>(input.patches.map((p: RouteStatePatch) => String(p.path[0])))].map((key) => ({ path: [key], value: (applied.envelope.doc as any)[key] }));
      }),
      describe: body(`${id}Describe`, `verbs.${id}.describe`, "describe", (input) => {
        const history = input.history ?? { label: "Edit" };
        const label = owner === own || history.label.endsWith(`from /${owner}`) ? history.label : `${history.label} · from /${owner}`;
        return spec.edits.describe({ ...history, label });
      }),
      ready: body(`${id}Ready`, `verbs.${id}.ready`, "ready", (ctx) => {
        const value = ctx.readings.value;
        const work = owner === own ? ctx.work : ctx.readings[reading].value;
        return value.current && (owner === own || ctx.readings[reading].current) && canonicalEnvironmentInput(work) === canonicalEnvironmentInput(value.value?.value?.data[config.value])
          ? true : "Read the current Value and owning Work before editing";
      }),
    };
  }
  for (const [id, command] of Object.entries(spec.commands)) {
    entries[command.entry] = command.contract; entries[command.plan] = command.planContract;
    readings[`${id}Plan`] = { kind: "use", entry: command.plan, args: body(`${id}PlanArgs`, `readings.${id}Plan.args`, "args", () => null), deps: empty, demand: "explicit", retain: policy.retain, refresh: "explicit" };
    verbs[id] = {
      kind: "command", entry: command.entry, input: "none", label: command.label, review: "shown",
      deps: { page: [spec.subject.field], work: workKeys, readings: Object.keys(readings).filter((r) => !r.endsWith("Plan")) }, captures: ["value"],
      intent: body(`${id}Intent`, `verbs.${id}.intent`, "intent", () => ({})),
      ready: body(`${id}Ready`, `verbs.${id}.ready`, "ready", (ctx) => command.requires?.some((path) => !path.split(".").reduce((value, key) => value?.[key], ctx.work)) ? "Choose write scope before planning" : true),
      present: body(`${id}Present`, `verbs.${id}.present`, "present", (result, ctx) => command.present(result, ctx.readings.value.value.value.data, ctx.work)),
    };
  }
  const panes: MutableTable<RouteGraphJson["panes"]> = {};
  for (const [id, pane] of Object.entries(spec.panes)) {
    const readId = pane.read === spec.core ? "value" : `pane:${id}`;
    if (readId !== "value") addRead(readId, pane.read);
    panes[id] = { label: pane.title, purpose: pane.purpose, draws: [readId, ...Object.keys(owners).filter((o) => o !== own).map((o) => `owner:${o}`)], verbs: Object.keys(verbs), body: body(id, `panes.${id}.body`, "pane", (ctx) => pane.draw(drawContext(ctx, readId, spec, owners) as DrawContext<D, F, z.output<W>, z.output<Edit>>)) };
  }
  const seeds: MutableTable<RouteGraphJson["seeds"]> = {};
  for (const [name, provide] of Object.entries(spec.core.fixtures ?? {})) {
    seeds[name] = { title: name, load: body(`fixture:${name}`, `seeds.${name}.load`, "seed", () => {
      const page = { ...Object.fromEntries(Object.entries(spec.fields).map(([key, field]) => [key, field.initial])), [spec.subject.field]: { kind: "ids", ids: [] } } as Page<F>;
      const packet: any = provide(spec.core.input.parse(spec.core.args(page)));
      return { readings: {}, work: packet.value?.data[owners[own]!.value], works: Object.fromEntries(Object.entries(owners).map(([key, owner]) => [key, packet.value?.data[owner.value]])) };
    }) };
  }
  const data: RouteGraphJson = {
    version: 1, key: spec.key, address: `/${spec.key}`, name: spec.name, directory: spec.directory,
    capabilities: ["work", "native-write", "geometry"], fields, identities: { subject: { kind: "local", codec: "local" }, focus: { kind: "local", codec: "local" } },
    subject: { field: spec.subject.field, noun: spec.subject.noun, roster: "value", detail: "value", pane: spec.subject.pane },
    historyDetail: "historyDetail", work: { schema: "work", route: own, version: spec.edits.work.schemaVersion ?? 1, migrations: {} },
    workFields, cells, panes, readings, verbs, seeds, layout: spec.layout, needs: "project", predicates: {}, observe: [], resetOnTarget: [], stageOrder: [mode],
    stages: { [mode]: { panes: Object.keys(panes), verbs: Object.keys(spec.commands), word: spec.name } },
  };
  const host: HostRouteModule = { data, schemas, bodies: {}, workState: spec.edits.work };
  return { data: data as Graph<F>, schemas: schemas as Schemas<F, W> & Record<string, z.ZodType>, codecs: codecs as { [K in keyof F]: ReturnType<typeof jsonCodec<F[K]["schema"]>> }, identities: { local: identityCodecs.local }, entries, bodies: bodies as unknown as BodyBindings<Graph<F>, Schemas<F, W>, typeof entries>, sources, host };
}

function drawContext(ctx: any, read: string, spec: Specification<any, Fields, z.ZodObject, z.ZodType>, owners: Owners): DrawContext<any, Fields, any, any> {
  const own = spec.edits.work.route;
  const packet = ctx.readings[read];
  const value = projectValue(packet, (packet: any) => packet.value?.data);
  const ownerOf = (path: readonly string[]) => {
    const owner = Object.entries(owners).find(([name, owner]) => name === own && Object.hasOwn(owner.state.schema.shape, path[0]!))
      ?? Object.entries(owners).find(([, owner]) => Object.hasOwn(owner.state.schema.shape, path[0]!));
    if (!owner) throw Error(`No owning Work for ${path.join(".")}`);
    return owner[0];
  };
  const patch = async (patches: readonly RouteStatePatch[], history: EditHistory = { label: "Edit" }): Promise<EditFailure> => {
    if (!patches.length) return null;
    if (!value.current || !ctx.workBasis) return { code: "unavailable", message: "Read the current Value and Work before editing" };
    try {
      const groups = new Map<string, RouteStatePatch[]>();
      for (const p of patches) { const owner = ownerOf(p.path.map(String)); groups.set(owner, [...(groups.get(owner) ?? []), p]); }
      // Capture each invocation synchronously before any owner's acknowledgement can invalidate it.
      const writes = [...groups].map(([owner, patches]) => {
        return ctx.verbs[owner === own ? "edit" : `edit:${owner}`]({ patches, history }, ...(owner === own ? [ctx.workBasis] : []));
      });
      const outcomes = await Promise.all(writes.map((observation: any) => new Promise<any>((resolve) => observation.subscribe((v: any) => { if (v.kind !== "pending") resolve(v); }, () => {}))));
      const refused = outcomes.filter((o) => o.kind === "refused");
      return refused.length ? { code: "refused", message: refused.map((o) => o.refusal?.error ?? o.reason).join("; ") } : null;
    } catch (error) { return { code: "refused", message: error instanceof Error ? error.message : String(error) }; }
  };
  return { value, page: ctx.page, fixture: ctx.fixture, cells: {
    doc: ctx.work, basis: ctx.workBasis, ready: !!ctx.workBasis && value.current,
    history: ctx.ownerHistory,
    owner(path) { const route = ownerOf(path); return { route, label: route === own ? "Work" : `from /${route}` }; },
    patch, edit(input, history) {
      if (!value.value) return Promise.resolve({ code: "unavailable", message: "Read the current Value before editing" });
      return patch(spec.edits.patches(spec.edits.input.parse(input), value.value), history);
    },
  } };
}

/** Selecting data preserves the publication's status; it never composes domain values. */
export function projectValue<A, B>(reading: ReadingSnapshot<A>, select: (value: Immutable<A>) => B): ReadingSnapshot<B> {
  return { ...reading, ...(reading.value === undefined ? {} : { value: select(reading.value) }) } as ReadingSnapshot<B>;
}
