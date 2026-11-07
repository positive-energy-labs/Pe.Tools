import { z } from "zod";
import {
  applyPatches,
  identityCodecs,
  jsonCodec,
  routeStatePatchSchema,
  commands,
  commandCatalogAxes,
  cellPatches,
  type HostRouteModule,
  type Immutable,
  type RouteGraphJson,
  type RouteStatePatch,
  type RouteStateSpec,
  type ReadingSnapshot,
} from "@pe/agent-contracts";
import { canonicalEnvironmentInput } from "../../../../packages/agent-contracts/src/route-kernel-environment.ts";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { LayoutJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type {
  PagePort,
  InvocationToken,
  IdentityId,
} from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import type {
  EntryContract,
  WorkHistoryPort,
} from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { Many } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import type { Publication } from "./host-read.ts";
import { settleWork } from "../shell/work-door-observation.ts";
import { bare } from "../../../../packages/agent-contracts/src/route-field.ts";

type Field = {
  schema: z.ZodType;
  initial: unknown;
  role: "pose" | "query" | "subject" | "stage";
  url: "push" | "replace";
};
export const whenSubject = (child: string | LayoutJson): LayoutJson => ({
  kind: "gate",
  when: "subject",
  child: typeof child === "string" ? { kind: "pane", id: child } : child,
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
export const subjectSchema = (max: number) => {
  const id = z.string().transform((value, ctx) => {
    const decoded = identityCodecs.local.decode(value);
    if (decoded.ok) return decoded.value;
    ctx.addIssue({ code: "custom", message: decoded.reason });
    return z.NEVER;
  });
  return z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("ids"), ids: z.array(id).max(max), active: id.optional() }),
    z.strictObject({ kind: z.literal("all") }),
  ]);
};
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
type Fields = Readonly<Record<string, Field>>;
type FieldValues<F extends Fields> = {
  readonly [K in keyof F]: Immutable<z.output<F[K]["schema"]>>;
};
type Page<F extends Fields> = FieldValues<F> & {
  readonly selected: readonly { kind: "focus"; id: IdentityId<"local"> }[];
};
type RoleFields<F extends Fields, R extends Field["role"]> = {
  [K in keyof F]: F[K]["role"] extends R ? K : never;
}[keyof F];
type DrawPage<F extends Fields> = Omit<
  PagePort<RouteGraphJson, {}>,
  "read" | "pose" | "query" | "select"
> & {
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
  readonly value: unknown;
  stage(value: unknown, history?: EditHistory): Promise<EditFailure>;
  clear(history?: EditHistory): Promise<EditFailure>;
}
export interface EditableCells<W, Edit> {
  readonly doc: Immutable<W> | null;
  readonly basis: InvocationToken | null;
  readonly ready: boolean;
  readonly history: WorkHistoryPort<any>;
  owner(path: readonly string[]): { route: string; label: string };
  at(path: readonly [string, ...string[]], owner?: string): OwnedCell;
  label(input: Edit, label: string): string;
  patch(patches: readonly RouteStatePatch[], history?: EditHistory): Promise<EditFailure>;
  edit(input: Edit, history?: EditHistory): Promise<EditFailure>;
}
export interface DrawContext<D, F extends Fields, W, Edit> {
  readonly target: import("../../../../packages/agent-contracts/src/route-kernel-page.ts").ScopeIdentity["target"];
  read<R extends HostRead>(read: R): ReadingSnapshot<ReadData<R>>;
  readonly value: ReadingSnapshot<D> & { readonly publication: Immutable<Publication<D>["value"]> };
  readonly page: DrawPage<F>;
  readonly selection: { read(): Page<F>["selected"]; set(value: Page<F>["selected"]): unknown };
  readonly cells: EditableCells<W, Edit>;
  write(command: string): { plan(): unknown; apply(): unknown; cancel(): unknown; read(): unknown };
}
type Owner = { state: RouteStateSpec<z.ZodObject>; value: string };
type Owners = Readonly<Record<string, Owner>>;
type HostRead = import("./host-read.ts").HostRead;
export type ReadData<R extends HostRead> = NonNullable<z.output<R["output"]>["value"]>["data"];
type MutableTable<T> = Record<string, T extends Readonly<Record<string, infer V>> ? V : never>;
type ProjectedField<K, R extends Field["role"]> = R extends "subject"
  ? {
      role: "subject";
      schema: K;
      codec: K;
      initial: unknown;
      url: "push" | "replace";
      share: true;
      agent: "set";
      cardinality: "many";
      identity: "subject";
      picker: { reading: "value"; options: "pickSubject" };
    }
  : {
      role: R;
      schema: K;
      codec: K;
      initial: unknown;
      url: "push" | "replace";
      share: true;
      agent: "set";
    };
type Graph<F extends Fields> = Omit<RouteGraphJson, "fields" | "work" | "identities"> & {
  fields: { [K in keyof F & string]: ProjectedField<K, F[K]["role"]> } & {
    selected: { role: "selection"; kinds: readonly ["focus"] };
  };
  identities: {
    subject: { kind: "local"; codec: "local" };
    focus: { kind: "local"; codec: "local" };
  };
  work: { schema: "work"; route: string; version: number; migrations: {} };
};
type Schemas<F extends Fields, W extends z.ZodObject> = { [K in keyof F]: F[K]["schema"] } & {
  work: W;
};
type Specification<
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
    options(
      data: Immutable<ReadData<SubjectRead>>,
    ): readonly { id: IdentityId<"local">; label: string }[];
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
    work: RouteStateSpec<W>;
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
// The projection is executable kernel output. Routes never author slot ids, deps, codecs or gates.
export function route<
  D,
  const F extends Fields,
  W extends z.ZodObject,
  Edit extends z.ZodType,
  const Reads extends Readonly<Record<string, HostRead>>,
  SubjectRead extends HostRead,
>(spec: Specification<D, F, W, Edit, Reads, SubjectRead>) {
  const schemas: Record<string, z.ZodType> = {
    none: z.strictObject({}),
    work: spec.edits.work.schema,
    historyDetail:
      spec.edits.history instanceof z.ZodObject
        ? spec.edits.history.omit({ label: true })
        : spec.edits.history,
  };
  const bodies: Record<
    string,
    {
      slot: string;
      kind: string;
      source: { module: string; export: string };
      run: (...args: any[]) => any;
    }
  > = {};
  const source = { module: "route/typed-route.ts", export: "route" };
  const body = (id: string, slot: string, kind: string, run: (...args: any[]) => any) => {
    bodies[id] = { slot, kind, source, run };
    return id;
  };
  const fields: MutableTable<RouteGraphJson["fields"]> = {};
  const codecs: Record<string, ReturnType<typeof jsonCodec>> = {};
  for (const [key, value] of Object.entries(spec.fields)) {
    schemas[key] = value.schema;
    codecs[key] = jsonCodec(value.schema);
    fields[key] = {
      role: value.role === "subject" ? "query" : value.role,
      schema: key,
      codec: key,
      initial: value.initial,
      url: value.url,
      share: true,
      agent: "set",
    };
  }
  schemas[spec.subject.field] = spec.fields[spec.subject.field]!.schema;
  codecs[spec.subject.field] = jsonCodec(spec.fields[spec.subject.field]!.schema);
  fields[spec.subject.field] = {
    role: "subject",
    schema: spec.subject.field,
    codec: spec.subject.field,
    initial: spec.fields[spec.subject.field]!.initial,
    url: "push",
    share: true,
    agent: "set",
    cardinality: "many",
    identity: "subject",
    picker: { reading: "value", options: "pickSubject" },
  };
  fields.selected = { role: "selection", kinds: ["focus"] };
  const mode = String(
    Object.values(spec.fields).find((field) => field.role === "stage")?.initial ?? "main",
  );
  const empty = { page: [], work: [], readings: [] };
  const policy = {
    demand: "visible",
    retain: { evidence: "scope", resource: "scope" },
    refresh: "dependencies",
  } as const;
  const entries: Record<string, EntryContract> = {};
  const readings: MutableTable<RouteGraphJson["readings"]> = {};
  const sources: Record<string, HostRead["source"]> = {};
  const readIds = new Map<HostRead, string>();
  const addRead = (id: string, read: HostRead & { args?(page: Page<F>): unknown }) => {
    readIds.set(read, id);
    entries[read.key] = read;
    sources[read.key] = read.source;
    readings[id] = {
      ...policy,
      kind: "use",
      entry: read.key,
      args: body(`${id}Args`, `readings.${id}.args`, "args", (ctx) =>
        (read.args ?? spec.core.args)(ctx.page),
      ),
      deps: { page: Object.keys(fields), work: [], readings: [] },
    };
  };
  addRead("value", spec.core);
  for (const [id, read] of Object.entries(spec.reads ?? {})) addRead(id, read);
  const subjectRead = spec.subject.read ? readIds.get(spec.subject.read) : "value";
  if (!subjectRead) throw Error("Subject read must be declared by the route");
  fields[spec.subject.field] = {
    ...fields[spec.subject.field]!,
    picker: { reading: subjectRead, options: "pickSubject" },
  } as (typeof fields)[string];
  body("pickSubject", `fields.${spec.subject.field}.picker.options`, "picker", (reading) =>
    reading.value?.value?.data ? spec.subject.options(reading.value.value.data) : [],
  );
  const own = spec.edits.work.route;
  const owners: Owners = {
    ...spec.edits.owners,
    [own]: { state: spec.edits.work, value: spec.edits.owners[own]?.value ?? "work" },
  };
  const workKeys = Object.keys(spec.edits.work.schema.shape);
  const verbs: MutableTable<RouteGraphJson["verbs"]> = {};
  const queryFields = Object.keys(spec.fields).filter((key) => spec.fields[key]!.role === "query");
  schemas.pageQuery = z
    .strictObject(Object.fromEntries(queryFields.map((key) => [key, spec.fields[key]!.schema])))
    .partial();
  verbs["page:query"] = {
    kind: "page",
    input: "pageQuery",
    label: "Browse",
    review: "none",
    captures: [],
    deps: empty,
    fields: queryFields,
    patch: body("pageQuery", "verbs.page:query.patch", "page", (_ctx, input) => input),
  };
  schemas.patch = z.object({
    patches: z.array(routeStatePatchSchema),
    history: spec.edits.history.optional(),
  });
  const cells: MutableTable<RouteGraphJson["cells"]> = {},
    workFields: MutableTable<NonNullable<RouteGraphJson["workFields"]>> = {};
  // Cell metadata derives from the same Work schema; record cells and scalar cells have one path.
  for (const key of workKeys) {
    let schema: any = spec.edits.work.schema.shape[key];
    while (schema.unwrap) schema = schema.unwrap();
    if (schema instanceof z.ZodRecord || schema?.shape?.edit) {
      schemas[`${key}Cell`] = schema instanceof z.ZodRecord ? schema.valueType : schema;
      cells[key] = {
        segment: schema instanceof z.ZodRecord ? key : null,
        value: `${key}Cell`,
        groupOf: body(`group${key}`, `cells.${key}.groupOf`, "group", (key) => [key]),
        deps: empty,
      };
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
      kind: "work",
      input: "patch",
      label: "Edit",
      review: "none",
      captures: [],
      deps: {
        page: [],
        work: owner === own ? workKeys : [],
        readings: ["value", ...(owner === own ? [] : [reading])],
      },
      ...(owner === own ? {} : { target: reading }),
      patches: body(`${id}Patches`, `verbs.${id}.patches`, "work", (ctx, input) => {
        const doc = owner === own ? ctx.work : ctx.readings[reading].value;
        const applied = applyPatches(
          config.state,
          { version: 1, revision: 0, doc },
          "human",
          input.patches,
          0,
          false,
          true,
        );
        if (!applied.ok) throw Error(applied.error);
        return [
          ...new Set<string>(input.patches.map((p: RouteStatePatch) => String(p.path[0]))),
        ].flatMap((key) =>
          bare(config.state.schema.shape[key]!) instanceof z.ZodRecord
            ? input.patches
                .filter((p: RouteStatePatch) => String(p.path[0]) === key)
                .map((p: RouteStatePatch) => ({
                  ...p,
                  path: p.path.map(String),
                  ...(!Object.hasOwn(p, "value") ? { op: "delete" } : {}),
                }))
            : [{ path: [key], value: (applied.envelope.doc as any)[key] }],
        );
      }),
      describe: body(`${id}Describe`, `verbs.${id}.describe`, "describe", (input) => {
        const history = input.history ?? { label: "Edit" };
        const label =
          owner === own || history.label.endsWith(`from /${owner}`)
            ? history.label
            : `${history.label} · from /${owner}`;
        return spec.edits.describe({ ...history, label });
      }),
      ready: body(`${id}Ready`, `verbs.${id}.ready`, "ready", (ctx) => {
        const value = ctx.readings.value;
        const work = owner === own ? ctx.work : ctx.readings[reading].value;
        return value.current &&
          (owner === own || ctx.readings[reading].current) &&
          canonicalEnvironmentInput(work) ===
            canonicalEnvironmentInput(value.value?.value?.data[config.value])
          ? true
          : "Read the current Value and owning Work before editing";
      }),
    };
  }
  for (const [id, command] of Object.entries(spec.commands)) {
    entries[command.entry] = command.contract;
    entries[command.plan] = command.planContract;
    readings[`${id}Plan`] = {
      kind: "use",
      entry: command.plan,
      args: body(`${id}PlanArgs`, `readings.${id}Plan.args`, "args", () => null),
      deps: empty,
      demand: "explicit",
      retain: policy.retain,
      refresh: "explicit",
    };
    verbs[id] = {
      kind: "command",
      entry: command.entry,
      input: "none",
      label: command.label,
      review: "shown",
      deps: {
        page: [spec.subject.field],
        work: workKeys,
        readings: [
          "value",
          ...Object.keys(owners)
            .filter((owner) => owner !== own)
            .map((owner) => `owner:${owner}`),
        ],
      },
      captures: ["value"],
      intent: body(`${id}Intent`, `verbs.${id}.intent`, "intent", () => ({})),
      present: body(`${id}Present`, `verbs.${id}.present`, "present", (result, ctx) =>
        command.present(result, ctx.readings.value.value.value.data, ctx.work),
      ),
    };
  }
  const panes: MutableTable<RouteGraphJson["panes"]> = {};
  for (const [id, pane] of Object.entries(spec.panes)) {
    const readId = readIds.get(pane.read) ?? `pane:${id}`;
    if (!readIds.has(pane.read)) addRead(readId, pane.read);
    panes[id] = {
      label: pane.title,
      purpose: pane.purpose,
      draws: [
        ...new Set([readId, "value", ...Object.keys(spec.reads ?? {})]),
        ...Object.keys(owners)
          .filter((o) => o !== own)
          .map((o) => `owner:${o}`),
      ],
      verbs: Object.keys(verbs),
      body: body(id, `panes.${id}.body`, "pane", (ctx) =>
        pane.draw(
          drawContext(ctx, readId, spec, owners, readIds) as DrawContext<
            ReadData<Reads[string]>,
            F,
            z.output<W>,
            z.output<Edit>
          >,
        ),
      ),
    };
  }
  const seeds: MutableTable<RouteGraphJson["seeds"]> = {};
  for (const name of Object.keys(spec.core.fixtures ?? {})) {
    seeds[name] = {
      title: name,
      load: body(`fixture:${name}`, `seeds.${name}.load`, "seed", () => {
        const page = {
          ...Object.fromEntries(
            Object.entries(spec.fields).map(([key, field]) => [key, field.initial]),
          ),
          [spec.subject.field]: { kind: "ids", ids: [] },
        } as Page<F>;
        const packet: any = spec.core.source.provide!(
          name,
          spec.core.input.parse(spec.core.args(page)),
        );
        return {
          readings: {},
          work: packet.value?.data[owners[own]!.value],
          works: Object.fromEntries(
            Object.entries(owners).map(([key, owner]) => [key, packet.value?.data[owner.value]]),
          ),
        };
      }),
    };
  }
  const data: RouteGraphJson = {
    version: 1,
    key: spec.key,
    address: `/${spec.key}`,
    name: spec.name,
    directory: spec.directory,
    capabilities: ["work", "native-write", "geometry"],
    fields,
    identities: {
      subject: { kind: "local", codec: "local" },
      focus: { kind: "local", codec: "local" },
    },
    subject: {
      field: spec.subject.field,
      noun: spec.subject.noun,
      roster: subjectRead,
      detail: "value",
      pane: spec.subject.pane,
    },
    historyDetail: "historyDetail",
    work: {
      schema: "work",
      route: own,
      version: spec.edits.work.schemaVersion ?? 1,
      migrations: {},
    },
    workFields,
    cells,
    panes,
    readings,
    verbs,
    seeds,
    layout: spec.layout,
    needs: "project",
    predicates: {
      subject: body("hasSubject", "predicates.subject", "predicate", (ctx) => {
        const subject = ctx.page[spec.subject.field];
        return subject.kind === "all" || subject.ids.length > 0;
      }),
    },
    observe: [],
    resetOnTarget: [],
    stageOrder: [mode],
    stages: {
      [mode]: { panes: Object.keys(panes), verbs: Object.keys(spec.commands), word: spec.name },
    },
  };
  const host: HostRouteModule = { data, schemas, bodies: {}, workState: spec.edits.work };
  return {
    data: data as Graph<F>,
    schemas: schemas as Schemas<F, W> & Record<string, z.ZodType>,
    codecs: codecs as { [K in keyof F]: ReturnType<typeof jsonCodec<F[K]["schema"]>> },
    identities: { local: identityCodecs.local },
    entries,
    bodies: bodies as unknown as BodyBindings<Graph<F>, Schemas<F, W>, typeof entries>,
    sources,
    host,
  };
}

function drawContext(
  ctx: any,
  read: string,
  spec: Specification<any, Fields, z.ZodObject, z.ZodType>,
  owners: Owners,
  readIds: ReadonlyMap<HostRead, string>,
): DrawContext<any, Fields, any, any> {
  const own = spec.edits.work.route;
  const packet = ctx.readings[read];
  const core = ctx.readings.value;
  const coreData = core.value?.value?.data;
  const projected = projectValue(packet, (packet: any) => packet.value?.data);
  const changed =
    coreData &&
    Object.entries(owners).some(([owner, config]) => {
      const work = owner === own ? ctx.work : ctx.readings[`owner:${owner}`]?.value;
      return (
        work &&
        canonicalEnvironmentInput(work) !== canonicalEnvironmentInput(coreData[config.value])
      );
    });
  const publication = packet.value?.value ?? null;
  const value =
    changed && read === "value"
      ? {
          ...projected,
          current: false as const,
          status: "unavailable" as const,
          reason: "Work changed; awaiting a current Value",
          publication,
        }
      : { ...projected, publication };
  const ownerOf = (path: readonly string[], preferred?: string) => {
    if (preferred !== undefined) {
      if (!owners[preferred] || !Object.hasOwn(owners[preferred].state.schema.shape, path[0]!))
        throw Error(`No editable ${path.join(".")} on /${preferred}`);
      return preferred;
    }
    const owner =
      Object.entries(owners).find(
        ([name, owner]) => name === own && Object.hasOwn(owner.state.schema.shape, path[0]!),
      ) ??
      Object.entries(owners).find(([, owner]) => Object.hasOwn(owner.state.schema.shape, path[0]!));
    if (!owner) throw Error(`No owning Work for ${path.join(".")}`);
    return owner[0];
  };
  const patch = async (
    patches: readonly RouteStatePatch[],
    history: EditHistory = { label: "Edit" },
    preferred?: string,
  ): Promise<EditFailure> => {
    if (!patches.length) return null;
    if (!value.current || !core.current || changed || !ctx.workBasis)
      return { code: "unavailable", message: "Read the current Value and Work before editing" };
    try {
      const groups = new Map<string, RouteStatePatch[]>();
      for (const p of patches) {
        const owner = ownerOf(p.path.map(String), preferred);
        groups.set(owner, [...(groups.get(owner) ?? []), p]);
      }
      // Capture each invocation synchronously before any owner's acknowledgement can invalidate it.
      const writes = [...groups].map(([owner, patches]) => {
        try {
          return settleWork(
            ctx.verbs[owner === own ? "edit" : `edit:${owner}`](
              { patches, history },
              ...(owner === own ? [ctx.workBasis] : []),
            ),
          );
        } catch (error) {
          return Promise.resolve({ kind: "refused" as const, refusal: { error: String(error) } });
        }
      });
      const outcomes = await Promise.all(writes);
      const refused = outcomes.filter((o) => o.kind === "refused");
      return refused.length
        ? { code: "refused", message: refused.map((o) => o.refusal.error).join("; ") }
        : null;
    } catch (error) {
      return { code: "refused", message: error instanceof Error ? error.message : String(error) };
    }
  };
  return {
    target: ctx.target,
    read(read) {
      const id = readIds.get(read);
      if (!id) throw Error(`Undeclared read: ${read.key}`);
      return projectValue(ctx.readings[id], (packet: any) => packet.value?.data);
    },
    value,
    page: { ...ctx.page, query: (patch) => ctx.verbs["page:query"](patch) },
    selection: {
      read: () => ctx.page.read().selected,
      set: (selected) => ctx.page.select(selected),
    },
    write(command) {
      if (!Object.hasOwn(spec.commands, command)) throw Error(`Unknown command: ${command}`);
      return { plan: () => ctx.verbs[command]({}), ...ctx.writeControls[command] };
    },
    cells: {
      doc: ctx.work,
      basis: ctx.workBasis,
      ready: !!ctx.workBasis && value.current && core.current && !changed,
      history: ctx.ownerHistory,
      owner(path) {
        const route = ownerOf(path);
        return { route, label: route === own ? "Work" : `from /${route}` };
      },
      at(path, owner) {
        const address = Object.freeze([...path]);
        const route = ownerOf(address, owner);
        const doc = route === own ? ctx.work : ctx.readings[`owner:${route}`]?.value;
        const cell = address.reduce((value, key) => value?.[key], doc) ?? {};
        return {
          owner: { route, label: route === own ? "Work" : `from /${route}` },
          value: cell,
          stage: (value, history) =>
            patch(
              cellPatches(address.slice(0, -1), address.at(-1)!, cell, {
                kind: "set",
                rung: { value },
              }),
              history,
              route,
            ),
          clear: (history) =>
            patch(
              cellPatches(address.slice(0, -1), address.at(-1)!, cell, { kind: "clear" }),
              history,
              route,
            ),
        };
      },
      label(input, label) {
        if (!coreData) return label;
        const foreign = [
          ...new Set(
            spec.edits.patches(input, coreData).map((patch) => ownerOf(patch.path.map(String))),
          ),
        ].filter((owner) => owner !== own);
        return foreign.length
          ? `${label} · ${foreign.map((owner) => `from /${owner}`).join(", ")}`
          : label;
      },
      patch,
      async edit(input, history) {
        if (!coreData)
          return Promise.resolve({
            code: "unavailable",
            message: "Read the current Value before editing",
          });
        try {
          return patch(spec.edits.patches(spec.edits.input.parse(input), coreData), history);
        } catch (error) {
          return { code: "invalid", message: String(error) };
        }
      },
    },
  };
}

/** Selecting data preserves the publication's status; it never composes domain values. */
export function projectValue<A, B>(
  reading: ReadingSnapshot<A>,
  select: (value: Immutable<A>) => B,
): ReadingSnapshot<B> {
  return {
    ...reading,
    ...(reading.value === undefined ? {} : { value: select(reading.value) }),
  } as ReadingSnapshot<B>;
}
