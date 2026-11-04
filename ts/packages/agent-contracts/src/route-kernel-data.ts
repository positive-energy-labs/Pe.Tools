import { z } from "zod";

export type Immutable<T> = T extends string | number | boolean | bigint | symbol | null | undefined
  ? T
  : T extends (...args: never[]) => unknown
    ? T
    : T extends object
      ? { readonly [K in keyof T]: Immutable<T[K]> }
      : T;

// ADR 0029 §7 keeps Zod in the contract kernel until the schema wave. Named
// schema/codec bindings preserve refinements which JSON Schema cannot express.
const ref = z.string().min(1);
const refs = z.array(ref);
// Initial bytes are opaque until the referenced field schema decodes them. Do not
// recursively expand Zod's JSON union through every generic route field during emit.
const initial: z.ZodType<unknown> = z.json();
const policy = {
  url: z.enum(["push", "replace"]).or(z.literal(false)),
  share: z.boolean(),
  agent: z.enum(["read", "set", "none"]),
};
const scalar = { schema: ref, codec: ref, initial, ...policy };
export const routeFieldJsonSchema = z.discriminatedUnion("role", [
  z.strictObject({
    role: z.literal("subject"),
    ...scalar,
    cardinality: z.enum(["one", "many"]),
    identity: z.union([ref, refs.min(2)]),
    picker: z.strictObject({ reading: ref, options: ref }),
  }),
  z.strictObject({ role: z.literal("selection"), kinds: refs }),
  z.strictObject({ role: z.literal("setting"), schema: ref, codec: ref, initial }),
  z.strictObject({
    role: z.enum(["pose", "stage", "query", "draft", "device", "transient"]),
    ...scalar,
  }),
]);

const dependencies = z.strictObject({ page: refs, work: refs, readings: refs });
const readingPolicy = {
  deps: dependencies,
  demand: z.enum(["subject", "visible", "explicit"]),
  retain: z.strictObject({
    evidence: z.enum(["scope", "session"]),
    resource: z.enum(["visible", "scope"]),
  }),
  refresh: z.enum(["explicit", "dependencies"]),
};
export const geometryDemandSchema = z.discriminatedUnion("representation", [
  z.strictObject({ representation: z.literal("overview"), entry: ref }),
  z.strictObject({
    representation: z.literal("detailed"),
    entry: ref,
    overview: ref,
    trigger: z.literal("explicit"),
    reachFt: z.number().min(5),
  }),
]);
// Detail demand/refresh are coupled at the outer reading, not advisory nested flags.
const useReading = { kind: z.literal("use"), entry: ref, args: ref.optional(), ...readingPolicy };
export const routeReadingJsonSchema = z.union([
  z.strictObject({ kind: z.literal("work"), route: ref, output: ref, ...readingPolicy }),
  z.strictObject({ ...useReading, geometry: geometryDemandSchema.options[0].optional() }),
  z.strictObject({
    ...useReading,
    demand: z.literal("explicit"),
    refresh: z.literal("explicit"),
    geometry: geometryDemandSchema.options[1],
  }),
  z.strictObject({ kind: z.literal("derive"), output: ref, derive: ref, ...readingPolicy }),
  z.strictObject({
    kind: z.enum(["worker", "port", "feed"]),
    entry: ref,
    adapter: ref,
    ...readingPolicy,
  }),
]);
const verb = {
  input: ref,
  label: z.string(),
  review: z.enum(["none", "shown"]),
  deps: dependencies,
  captures: refs,
  ready: ref.optional(),
  present: ref.optional(),
  chord: ref.optional(),
};
export const routeVerbJsonSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("work"), ...verb, patches: ref, describe: ref.optional() }),
  z.strictObject({ kind: z.literal("page"), ...verb, patch: ref, fields: refs }),
  z.strictObject({
    kind: z.literal("command"),
    ...verb,
    entry: ref,
    intent: ref,
    lands: ref.optional(),
  }),
  z.strictObject({
    kind: z.literal("query"),
    ...verb,
    entry: ref,
    /** Required when multiple declared readings use the same entry. */
    reading: ref.optional(),
    args: ref,
    cancellation: z.literal("scope"),
    lands: ref.optional(),
  }),
]);
const placement = z.union([refs, z.strictObject({ choose: ref, allowed: refs, row: ref })]);
const pane = z.strictObject({
  label: z.string(),
  purpose: z.string(),
  draws: refs,
  verbs: placement,
  body: ref.optional(),
  history: z.strictObject({ receipts: ref.optional() }).optional(),
  frame: z
    .strictObject({
      picture: z.boolean().optional(),
      scroll: z.enum(["auto", "clip", "visible"]).optional(),
      flush: z.boolean().optional(),
      header: z.literal(false).optional(),
    })
    .optional(),
});
export type LayoutJson =
  | { readonly kind: "pane"; readonly id: string }
  | { readonly kind: "gate"; readonly when: string; readonly child: LayoutJson }
  | {
      readonly kind: "split";
      readonly id: string;
      readonly axis: "h" | "v";
      readonly size: number;
      readonly children: readonly LayoutJson[];
      readonly sized?: "start" | "end";
      readonly minSize?: number;
      readonly maxSize?: number;
      readonly minOtherSize?: number;
      readonly persist?: string;
      readonly rails?: Partial<
        Record<"start" | "end", { readonly title: string; readonly collapseBelow?: number }>
      >;
    };
const layout: z.ZodType<LayoutJson> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("pane"), id: ref }),
    z.strictObject({ kind: z.literal("gate"), when: ref, child: layout }),
    z.strictObject({
      kind: z.literal("split"),
      id: ref,
      axis: z.enum(["h", "v"]),
      size: z.number().positive(),
      children: z.array(layout).min(2),
      sized: z.enum(["start", "end"]).optional(),
      minSize: z.number().nonnegative().optional(),
      maxSize: z.number().positive().optional(),
      minOtherSize: z.number().nonnegative().optional(),
      persist: ref.optional(),
      rails: z
        .strictObject({
          start: z
            .strictObject({ title: z.string(), collapseBelow: z.number().nonnegative().optional() })
            .optional(),
          end: z
            .strictObject({ title: z.string(), collapseBelow: z.number().nonnegative().optional() })
            .optional(),
        })
        .optional(),
    }),
  ]),
);

/** Shape decoding only. A owns semantic reference/slot linking and atomic admission.
 * All references are local table keys, except catalog entry ids and contract refs.
 * No function, schema instance, implicit codec, or inferred catalog axis is data. */
export const RouteGraphJson = z.strictObject({
  version: z.literal(1),
  capabilities: z
    .array(z.enum(["work", "geometry", "native-write"]))
    .refine(
      (groups) => new Set(groups).size === groups.length,
      "Capability groups must be distinct",
    ),
  key: ref,
  address: z.string().startsWith("/"),
  name: z.string(),
  directory: z.strictObject({
    group: z.string(),
    summary: z.string(),
    label: z.string(),
    icon: z.string(),
    exposure: z.enum(["Main", "Preview", "Archive"]),
    surfaces: z.strictObject({
      web: z.enum(["full", "compact"]).or(z.literal(false)),
      pwa: z.enum(["full", "compact"]).or(z.literal(false)),
      tray: z.enum(["full", "compact"]).or(z.literal(false)),
    }),
    aliases: refs,
    runtimeNeed: z.string(),
    listed: z.boolean(),
    satellites: z.array(z.strictObject({ to: z.string(), label: z.string() })),
    resume: z.literal("document").optional(),
  }),
  fields: z.record(ref, routeFieldJsonSchema),
  identities: z.record(
    ref,
    z.strictObject({ kind: z.enum(["document", "link", "element", "local"]), codec: ref }),
  ),
  subject: z.strictObject({
    field: ref,
    noun: z.string(),
    roster: ref,
    detail: ref,
    pane: ref,
    show: ref.optional(),
  }),
  subjectText: ref.optional(),
  /** Neutral schema for route-owned history metadata. */
  historyDetail: ref.optional(),
  work: z.strictObject({
    schema: ref,
    route: ref,
    version: z.number().int().positive(),
    migrations: z.record(z.string().regex(/^[1-9][0-9]*$/), ref),
  }).optional(),
  readings: z.record(ref, routeReadingJsonSchema),
  verbs: z.record(ref, routeVerbJsonSchema),
  panes: z.record(ref, pane),
  layout,
  stages: z.record(ref, z.strictObject({ word: z.string(), panes: refs, verbs: refs })),
  stageOrder: refs,
  predicates: z.record(ref, ref),
  transition: ref.optional(),
  /** Evidence projection for transition; omitted means no evidence dependencies. */
  transitionDeps: dependencies.optional(),
  salvage: ref.optional(),
  /** Display-only recovery review, with evidence captured before recovery acquisition. */
  salvagePresent: ref.optional(),
  salvageDeps: dependencies.optional(),
  cells: z.record(
    ref,
    z.strictObject({
      segment: ref.nullable(),
      key: ref.optional(),
      value: ref,
      groupOf: ref,
      show: ref.optional(),
      label: ref.optional(),
      focus: ref.optional(),
      take: ref.optional(),
      admit: ref.optional(),
      deps: dependencies,
    }),
  ),
  workFields: z.record(ref, z.strictObject({ label: z.string(), internal: z.boolean() })),
  seeds: z.record(ref, z.strictObject({ title: z.string(), load: ref })),
  needs: z.enum(["nothing", "session", "document", "project", "family"]),
  optionalTarget: z.enum(["session", "document"]).optional(),
  workSubject: ref.optional(),
  capture: ref.optional(),
  resetOnTarget: refs,
  refresh: ref.optional(),
  observe: refs,
});
export type RouteGraphJson = Immutable<z.output<typeof RouteGraphJson>>;
export type FieldJson = RouteGraphJson["fields"][string];
export type ReadingDependencies = RouteGraphJson["readings"][string]["deps"];

/** A linker reports the declaration slot, never just a registry lookup failure. */
export interface RouteDiagnostic {
  readonly path: string;
  readonly reference: string;
  readonly namespace: string;
  readonly version: number;
  readonly expected: string;
  readonly source: { readonly module: string; readonly export: string } | null;
  readonly code:
    | "missing"
    | "extra"
    | "kind"
    | "schema"
    | "reference"
    | "cycle"
    | "identity"
    | "policy";
  readonly message: string;
}
