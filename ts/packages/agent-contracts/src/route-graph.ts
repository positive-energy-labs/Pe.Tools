import type { AppExposure, AppRouteMount, AppSurface } from "./route-directory.ts";
import { z } from "zod";
import { stableKeyKinds, type History, type RouteField } from "./route-field.ts";
import type { RouteStatePatch } from "./route-state.ts";
import type { RouteViewRefusalCode } from "./route-view.ts";

/** Executable read entries are supplied by adapters; the kernel owns admission and validation. */
export interface ReadEntry<S extends z.ZodType = z.ZodType, R = unknown> {
  key: string;
  input: S;
  run(
    input: z.output<S>,
    context: {
      target: import("./target.ts").ExecutionTarget;
      work: import("./command.ts").WorkHandle | null;
    },
  ): Promise<R>;
}

export type FieldRole =
  | "subject"
  | "stage"
  | "selection"
  | "pose"
  | "query"
  | "draft"
  | "device"
  | "setting"
  | "transient";

export interface FieldPolicy {
  url: History | false;
  share: boolean;
  agent: "read" | "set" | false;
}

/** RouteField owns schema and codec. False explicitly opts out of a role's projection default. */
export type FieldDecl<S extends z.ZodType = z.ZodType> = Omit<RouteField<S>, keyof FieldPolicy> &
  Partial<FieldPolicy> & {
    label?: string;
    control?: "color" | "switch";
    /**
     * Where a person edits the field. A field with a picker or an enum draws a picker; free text is
     * the exception the field declares (`text`), never the default for a bare string or number.
     */
    editor?: "pane" | "situation" | "text";
    picker?: {
      reading: string;
      placeholder: string;
      options(value: unknown): readonly { id: string; label: string }[];
    };
  };

export const fieldRoleDefaults: Readonly<Record<FieldRole, Readonly<FieldPolicy>>> = {
  subject: { url: "push", share: true, agent: "set" },
  stage: { url: "push", share: true, agent: "set" },
  selection: { url: "replace", share: true, agent: "set" },
  pose: { url: "replace", share: true, agent: "set" },
  query: { url: "replace", share: true, agent: "set" },
  draft: { url: "replace", share: false, agent: "set" },
  device: { url: false, share: false, agent: "read" },
  setting: { url: false, share: false, agent: "set" },
  transient: { url: false, share: false, agent: false },
};

export function graphFieldPolicy(field: Partial<FieldPolicy> & { role: FieldRole }): FieldPolicy {
  const defaults = fieldRoleDefaults[field.role];
  if (field.role === "setting") return defaults;
  return {
    url: field.url ?? defaults.url,
    share: field.share ?? defaults.share,
    agent: field.agent ?? defaults.agent,
  };
}

/**
 * Every attempt is keyed by exact Target (session + openId), Work identity, and an unreused
 * generation. Retire that generation on scope change. Parts, completion, and failure all check
 * it; returning A -> B -> A cannot revive A's retired attempt. Dependencies name inputs, not
 * permission to reuse an attempt (S0a-families-race).
 */
export interface ReadingDecl<P = unknown> {
  kind: "use" | "derive" | "worker" | "port" | "feed";
  source: string;
  /** A query of this identity publishes directly into the reading when explicitly invoked. */
  query?: string;
  args?: (page: Readonly<P>) => unknown;
  deps?: readonly string[];
  retire: "target" | "page" | "never";
}

/** Platform-neutral spelling, e.g. Mod+Enter. The kernel's key adapter owns parsing. */
export type Chord = string;

/**
 * `work` writes Work patches, `command` runs a semantic command, `query` runs a host read outside
 * the command table, `recovery` is the kernel's own way out of Work it cannot read: no patches,
 * no command.
 */
export interface VerbDecl<S extends z.ZodType = z.ZodType> {
  caller?: "human" | "any";
  kind: "work" | "command" | "query" | "recovery" | "page";
  /** Semantic command or host read identity, retained in the graph's agent projection. */
  does?: string;
  /** A query whose result names the subject Work the graph's `workSubject` field then selects. */
  selects?: "work";
  subject?: string;
  input: S;
  /** At most `shown` (ADR 0027 rule 11): Pea may skip it; no review blocks on a person. */
  review: "none" | "shown";
  chord?: Chord;
  label: string;
  says?: string;
  effect?: "query" | "command";
  /** The Situation band's framed verb. Undeclared, the band frames the stage's first model write. */
  primary?: true;
}

/** Dynamic placement declares its possible ids without executing a row callback at admission.
 * The kernel also checks that each resolved row returns only ids in this list. */
export type VerbPlacement<Row = never> =
  | readonly string[]
  | (((row: Row) => readonly string[]) & { readonly ids: readonly string[] });

export interface PaneDecl<Row = never> {
  /** Presentation belongs to the kernel leaf, never a nested route-owned Pane. */
  frame?: {
    picture?: boolean;
    scroll?: "auto" | "clip" | "visible";
    flush?: boolean;
    header?: false;
  };
  /** Render the kernel timeline, optionally joined to a declared receipt reading. */
  history?: { receipts?: string };
  label: string;
  purpose: string;
  draws: readonly string[];
  verbs: VerbPlacement<Row>;
  chords?: Readonly<Record<string, Chord>>;
}

export interface SplitOptions {
  minSize?: number;
  maxSize?: number;
  minOtherSize?: number;
  /** Device-only size persistence. Fold state is persisted by the mounted graph. */
  persist?: string;
  /** Responsive fallback, deepest split first. Omit for named leaf rails. */
  rails?: Partial<Record<"start" | "end", { title: string; collapseBelow?: number }>>;
  axis: "h" | "v";
  sized: "start" | "end";
  size: number;
}

/** The kernel reduces gated empty branches bottom-up; a single survivor fills its branch. */
export type LayoutNode =
  | ({ kind: "split"; id: string; children: readonly LayoutNode[] } & SplitOptions)
  | { kind: "pane"; id: string }
  | { kind: "gate"; when: string; child: LayoutNode };

export const split = (
  id: string,
  options: SplitOptions,
  ...children: [LayoutNode, LayoutNode, ...LayoutNode[]]
): LayoutNode => ({ kind: "split", id, ...options, children });
export const pane = (id: string): LayoutNode => ({ kind: "pane", id });
export const gate = (when: string, child: LayoutNode): LayoutNode => ({
  kind: "gate",
  when,
  child,
});

export interface StageDecl {
  word: string;
  panes: readonly string[];
  verbs: readonly string[];
  chords?: Readonly<Record<string, Chord>>;
  teach?: string;
}

/** Matches the existing PageTransition's atomic patch/refusal shape, without importing web. */
export type GraphTransition<P> = (
  current: Readonly<P>,
  patch: Readonly<Partial<P>>,
  origin: "page" | "action" | "pea" | "url" | "initial",
  scope?: {
    readings: Readonly<Record<string, { value?: unknown; current: boolean; status: string }>>;
  },
) =>
  | { readonly patch: Partial<P> }
  | { readonly refusal: { readonly code: RouteViewRefusalCode; readonly message: string } };

/** The kernel-owned verbs of a Work's staged cells; their ids are reserved. Typing is the set. */
export const CELL_VERB_KINDS = ["clear", "delete"] as const;
export type CellVerbKind = (typeof CELL_VERB_KINDS)[number];

/** One family of authored cells in a route's Work, as the Situation and the Chat head read it. */
export interface CellsDecl<W = unknown> {
  /** The Work segment holding the keyed cells; null = one root cell at `key` (`scope`, `launch`). */
  segment: string | null;
  key?: string;
  /** A key's group path; `nouns` names its depths, singular ("parameter", "family"). */
  groupOf: (key: string) => string[];
  nouns?: readonly string[];
  /** The head's subject for these cells; absent = the thread's document. */
  noun?: string;
  show?: (value: unknown) => string;
  /** A group's words for the person when its path key is a machine key. */
  label?: (group: string) => string;
  /** The page fields that land a review on this cell's own place in the route. */
  focus?: (key: string) => Record<string, string>;
  /** The head's commit: `open` the route (default), or `plan` there ("apply", one per Work). */
  commit?: "open" | "plan";
  /** Why the head may not write these patches (only the route can), else null. */
  admit?(doc: W, patches: readonly RouteStatePatch[]): { code: string; message: string } | null;
}

export interface WorkFieldDecl {
  label: string;
  internal?: boolean;
}

/** The subject type of a cell family's rows, and the reserved verb ids derived from it. */
export const cellSubjectType = (family: Pick<CellsDecl, "segment" | "key">): string =>
  `cell:${family.segment ?? family.key}`;
export const cellVerbId = (family: Pick<CellsDecl, "segment" | "key">, kind: CellVerbKind) =>
  `${cellSubjectType(family)}.${kind}`;

/** The kernel's recovery for Work the host cannot read; reserved on every graph with Work. */
export const START_FRESH_VERB = "work.start-fresh";
export const startFreshVerb = {
  kind: "recovery",
  label: "Start fresh",
  says: "Set the unreadable Work aside and start it empty; its old bytes are kept beside it",
  review: "shown",
  input: z.strictObject({}).default({}),
} as const satisfies VerbDecl;

/**
 * The kernel's carry-over of what the host set aside (or cannot read) into readable Work: one
 * Work write, so one journal step. Declared on every graph whose `salvage` hook is set.
 */
export const SALVAGE_VERB = "work.salvage";
export const salvageVerb = {
  kind: "recovery",
  label: "Carry over",
  says: "Carry what the set-aside Work held into this Work, as one undoable edit",
  review: "shown",
  input: z.strictObject({}).default({}),
} as const satisfies VerbDecl;

export interface RouteDirectory {
  path: string;
  title: string;
  label: string;
  icon: string;
  category: string;
  blurb: string;
  aliases: readonly string[];
  exposure: AppExposure;
  listed: boolean;
  runtimeNeed: string;
  resume?: "document";
  satellites: readonly { to: string; label: string }[];
  surfaces: Readonly<Record<AppSurface, AppRouteMount | false>>;
}

export interface RouteGraph<P = Record<string, unknown>, W = unknown> {
  /** Browser-only states, selected uniformly by ?fixture=<name>. Payloads load only when selected; titles remain available to discovery. */
  seeds?: Readonly<Record<string, GraphSeed<P, W>>>;
  directory?: RouteDirectory;
  /** Injected from the source bytes by the build; never copied from the directory. */
  moduleHash?: string;
  key: string;
  address: string;
  name: string;
  /** The Situation's sentence about the shareable subject; no reads or effects. */
  subject?: (page: Readonly<P>) => string;
  subjectField: {
    /** A route-wide catalogue or authored case with one fixed key. Still requires roster/detail. */
    kind?: "singleton";
    field: keyof P & string;
    noun: string;
    keyKind: import("./route-field.ts").StableKeyKind;
    cardinality: "one" | "many";
    roster: string;
    detail: string;
    pane: string;
    show(id: string): string;
  };
  fields: {
    readonly [K in keyof P]-?: FieldDecl<z.ZodType<P[K]>> & { role: FieldRole };
  } & Readonly<Record<string, FieldDecl & { role: FieldRole }>>;
  readings: Readonly<Record<string, ReadingDecl<P>>>;
  verbs: Readonly<Record<string, VerbDecl>>;
  /** The verb every pane head's refresh runs (a host cache read again); absent, it re-reads the pane's draws. Never a stage verb. */
  refresh?: string;
  panes: Readonly<Record<string, PaneDecl>>;
  layout: LayoutNode;
  stages: Readonly<Record<string, StageDecl>>;
  /**
   * What Target the kernel resolves before the route acts, with the old manifest's values and
   * meaning: absent = the host (no document read); otherwise a `?target` pin, else the machine's
   * sole user document of that kind. Host-owned Work needs no Revit Target.
   */
  needs?: "session" | "document" | "project" | "family";
  /** Resolve available context without preventing host-only verbs when no Target is chosen. */
  optionalTarget?: "session" | "document";
  /** Review-free observation verbs, attempted once per visible Work identity. */
  observe?: readonly string[];
  /** The Work document's schema; required to declare `cells`, whose segments it must contain. */
  work?: z.ZodType<W>;
  /** Domain Work shared by multiple subject routes; defaults to the graph key. */
  workRoute?: string;
  /**
   * The Page field whose value names the subject Work (`binding: "workspace"`), so Work follows
   * Page selection. Empty falls back to the `?work=` carry, then the resolved document's Work.
   */
  workSubject?: keyof P & string;
  /** A selected immutable capture closes every Work write, even when its document is open. */
  capture?: keyof P & string;
  /** Page scope owned by a Target; reset to field defaults on a subsequent Target change. */
  resetOnTarget?: readonly (keyof P & string)[];
  /**
   * What the host's salvage read (`work.salvage`) carries over, as the patches this Work still
   * lacks: empty when everything is already here. The kernel applies them as one Work write.
   */
  salvage?: (
    salvaged: unknown,
    work: W | null,
    /** The current reading states, so an ID-only carry-over can resolve names from the exact catalog. */
    scope: { readings: Readonly<Record<string, { readonly current: unknown }>> },
  ) => readonly RouteStatePatch[];
  /** Authored segments of Work; the kernel owns clear and delete for them. */
  cells?: readonly CellsDecl<W>[];
  /**
   * A person's name for each other top-level Work field, declared once; History and Inputs never
   * show a raw Work path. `internal` fields (staging, bookkeeping) stay out of Inputs. The kernel
   * declares `writeIntent` itself.
   */
  workFields?: Readonly<Record<string, WorkFieldDecl>>;
  transition?: GraphTransition<P>;
  predicates?: Readonly<Record<string, (page: Readonly<P>, work: W | null) => boolean>>;
  /** Defaults to stage declaration order. The projection retains it despite sorting map keys. */
  stageOrder?: readonly string[];
}

export interface GraphSeed<P, W> {
  title: string;
  load(): Promise<GraphSeedData<P, W>>;
}

export interface GraphSeedData<P, W> {
  page?: Partial<P>;
  work?: W;
  /** Optional initial documents keyed by the graph workSubject (e.g. Pod members). */
  works?: Readonly<Record<string, W>>;
  target?: import("./target.ts").ExecutionTarget;
  /** Keys are graph reading ids. Missing readings fail explicitly in the fixture lane. */
  readings: Readonly<Record<string, unknown>>;
  /** Keys are query identities (verb.does). Commands and RPCs always refuse. */
  queries?: Readonly<Record<string, unknown>>;
}

export type GraphJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly GraphJsonValue[]
  | { readonly [key: string]: GraphJsonValue };
type GraphJsonObject = { readonly [key: string]: GraphJsonValue };

/** Executable bindings are marked, never stringified or invoked. Pod admission also hashes
 * the module: this descriptor alone cannot attest the behavior of functions or codecs. */
export interface RouteGraphJson {
  readonly seeds?: Readonly<Record<string, { readonly title: string }>>;
  readonly key: string;
  readonly directory?: RouteDirectory;
  readonly address: string;
  readonly name: string;
  readonly subject?: GraphJsonObject;
  readonly fields: Readonly<Record<string, GraphJsonObject>>;
  readonly readings: Readonly<Record<string, GraphJsonObject>>;
  readonly verbs: Readonly<Record<string, GraphJsonObject>>;
  readonly panes: Readonly<Record<string, GraphJsonObject>>;
  readonly layout: GraphJsonObject;
  readonly stages: Readonly<Record<string, GraphJsonObject>>;
  readonly needs?: RouteGraph["needs"];
  readonly optionalTarget?: RouteGraph["optionalTarget"];
  readonly observe?: readonly string[];
  readonly work?: GraphJsonObject;
  readonly workSubject?: string;
  readonly workRoute?: string;
  readonly cells?: readonly GraphJsonObject[];
  readonly stageOrder: readonly string[];
  readonly transition?: GraphJsonObject;
  readonly predicates?: Readonly<Record<string, GraphJsonObject>>;
}

function sortedJson(value: unknown): GraphJsonValue {
  // Installed Zod 4 owns JSON Schema conversion. Input direction retains preprocessing inputs.
  if (value instanceof z.ZodType)
    return sortedJson(
      z.toJSONSchema(value, {
        io: "input",
        unrepresentable: "any",
        override: ({ zodSchema, jsonSchema }) => {
          if (["custom", "transform"].includes(zodSchema._zod.def.type))
            jsonSchema["x-runtime-validation"] = true;
        },
      }),
    );
  if (typeof value === "function") {
    const ids = "ids" in value ? value.ids : undefined;
    return ids === undefined ? { runtime: true } : { ids: sortedJson(ids), runtime: true };
  }
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sortedJson(item)]),
    );
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  throw new Error("Route graph projection requires JSON values or declared runtime bindings");
}

export function projectRouteGraph<P, W>(graph: RouteGraph<P, W>): RouteGraphJson {
  const fields = Object.fromEntries(
    Object.entries(graph.fields).map(([key, field]) => {
      const declared = field as FieldDecl & { role: FieldRole };
      return [key, { ...declared, ...graphFieldPolicy(declared) }];
    }),
  );
  return sortedJson({
    ...graph,
    // Pea discovers fixture names; browser-only meshes and canned readings stay out of its contract.
    seeds:
      graph.seeds &&
      Object.fromEntries(
        Object.entries(graph.seeds).map(([name, seed]) => [name, { title: seed.title }]),
      ),
    // Kernel-owned verbs are part of what Pea may invoke; the cell verbs derive from `cells`.
    verbs: graph.work
      ? {
          ...graph.verbs,
          [START_FRESH_VERB]: startFreshVerb,
          ...(graph.salvage && { [SALVAGE_VERB]: salvageVerb }),
        }
      : graph.verbs,
    fields,
    stageOrder: graph.stageOrder ?? Object.keys(graph.stages),
  }) as unknown as RouteGraphJson;
}

/** Web Crypto keeps the contract browser-safe; hash canonical UTF-8 JSON, even after JSON reload. */
export async function routeGraphHash(json: RouteGraphJson): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(sortedJson(json)));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface RouteGraphRefusal {
  code:
    | "missing-pane"
    | "missing-reading"
    | "missing-verb"
    | "unknown-gate"
    | "chord-conflict"
    | "missing-segment"
    | "reserved-verb"
    | "stage-order"
    | "invalid-graph";
  path: string;
  message: string;
}

const placedIds = (placement: VerbPlacement): readonly string[] =>
  typeof placement === "function" ? placement.ids : placement;
const chordKey = (chord: Chord) =>
  chord
    .toLowerCase()
    .split("+")
    .map((key) => key.trim())
    .sort()
    .join("+");

type ZodDef = { type: string; innerType?: z.ZodType; shape?: Record<string, z.ZodType> };
const defOf = (schema: z.ZodType) => (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
/** Looks through optional, default and nullable wrappers to the schema that holds the shape. */
function unwrapSchema(schema: z.ZodType): ZodDef {
  let def = defOf(schema);
  while (def.innerType && ["optional", "default", "nullable", "prefault"].includes(def.type))
    def = defOf(def.innerType);
  return def;
}

/** The same dependency declaration governs admission, capture and review invalidation. */
export interface VerbReadingEdges {
  /** Captures started by a verb, not prerequisites of its binding. */
  verbReadings?: Readonly<Record<string, readonly string[]>>;
  /** Reading prerequisites of a verb's binding and review basis. */
  verbDepends?: Readonly<Record<string, readonly string[]>>;
}

export function validateRouteGraph<P, W>(
  graph: RouteGraph<P, W>,
  edges: VerbReadingEdges = {},
): RouteGraphRefusal[] {
  const refusals: RouteGraphRefusal[] = [];
  const refuse = (code: RouteGraphRefusal["code"], path: string, message: string) => {
    // A pane shared by several stages is checked once per stage; say each refusal once.
    if (!refusals.some((r) => r.code === code && r.path === path && r.message === message))
      refusals.push({ code, path, message });
  };
  try {
    // TODO: docs/features/routes/LEDGER.md#s7-dd18c610fe Supply genuine roster/detail bindings in graphs still missing subjectField; admission stays closed.
    if (!graph.subjectField)
      refuse(
        "invalid-graph",
        "subjectField",
        "Every route must declare its subject field, noun, stable key, cardinality, roster and detail",
      );
    // TODO: docs/features/routes/LEDGER.md#s7-d234a3544a Consolidate remaining Page selection fields instead of relabeling competing copies.
    const selections = Object.values(graph.fields).filter((field) => field.role === "selection");
    if (selections.length !== 1)
      refuse(
        "invalid-graph",
        "fields",
        "Page must declare exactly one kernel-owned selection field",
      );
    if (graph.subjectField) {
      const subject = graph.subjectField;
      if (!subject.noun?.trim() || !["one", "many"].includes(subject.cardinality))
        refuse("invalid-graph", "subjectField", "Subject requires a noun and explicit cardinality");
      if (subject.kind === "singleton") {
        const schema = graph.fields[subject.field]?.schema;
        const definition = schema && unwrapSchema(schema);
        const entries =
          definition && (definition as unknown as { entries?: Record<string, string> }).entries;
        if (
          subject.cardinality !== "one" ||
          definition?.type !== "enum" ||
          Object.keys(entries ?? {}).length !== 1
        )
          refuse(
            "invalid-graph",
            "subjectField",
            "A singleton subject requires one fixed named key",
          );
      }
      const subjects = Object.entries(graph.fields).filter(([, f]) => f.role === "subject");
      if (subjects.length !== 1 || subjects[0]?.[0] !== subject.field)
        refuse("invalid-graph", "subjectField", "Declare exactly one subject field");
      if (!stableKeyKinds.includes(subject.keyKind))
        refuse(
          "invalid-graph",
          "subjectField.keyKind",
          "Subject keys must be stable identity, never ElementId or display fields",
        );
      for (const id of [subject.roster, subject.detail])
        if (!graph.readings[id])
          refuse("missing-reading", "subjectField", `Unknown reading '${id}'`);
    }
    for (const [id, field] of Object.entries(graph.fields))
      if (field.picker && !Object.hasOwn(graph.readings, field.picker.reading))
        refuse(
          "missing-reading",
          `fields.${id}.picker`,
          `Unknown reading '${field.picker.reading}'`,
        );
    const closure = (roots: readonly string[], path: string) => {
      const reached = new Set<string>(),
        visiting = new Set<string>();
      const visit = (id: string) => {
        if (id === "page" && !graph.readings.page) return;
        if (visiting.has(id)) {
          refuse("invalid-graph", path, `Reading dependency cycle at '${id}'`);
          return;
        }
        if (reached.has(id)) return;
        const reading = graph.readings[id];
        if (!reading) {
          refuse("missing-reading", path, `Unknown reading '${id}'`);
          return;
        }
        reached.add(id);
        visiting.add(id);
        for (const dep of reading.deps ?? []) visit(dep);
        visiting.delete(id);
      };
      roots.forEach(visit);
      return reached;
    };
    closure(Object.keys(graph.readings), "readings");
    for (const [kind, declarations] of Object.entries(edges))
      for (const [verb, ids] of Object.entries(declarations ?? {})) {
        if (!graph.verbs[verb]) refuse("missing-verb", `${kind}.${verb}`, `Unknown verb '${verb}'`);
        closure(ids as readonly string[], `${kind}.${verb}`);
      }
    const checkVerb = (id: string, path: string) => {
      if (!Object.hasOwn(graph.verbs, id)) refuse("missing-verb", path, `Unknown verb '${id}'`);
    };
    if (graph.refresh) checkVerb(graph.refresh, "refresh");
    for (const [id, declared] of Object.entries(graph.panes)) {
      for (const reading of declared.draws)
        if (!Object.hasOwn(graph.readings, reading))
          refuse("missing-reading", `panes.${id}.draws`, `Unknown reading '${reading}'`);
      for (const verb of placedIds(declared.verbs)) checkVerb(verb, `panes.${id}.verbs`);
    }
    for (const [id, stage] of Object.entries(graph.stages)) {
      const verbs = new Set(stage.verbs);
      for (const paneId of stage.panes) {
        const declared = Object.hasOwn(graph.panes, paneId) ? graph.panes[paneId] : undefined;
        if (!declared) refuse("missing-pane", `stages.${id}.panes`, `Unknown pane '${paneId}'`);
        else for (const verb of placedIds(declared.verbs)) verbs.add(verb);
      }
      const demanded = closure(
        stage.panes.flatMap((pane) => graph.panes[pane]?.draws ?? []),
        `stages.${id}`,
      );
      if (graph.refresh) verbs.add(graph.refresh);
      for (const verb of graph.observe ?? []) verbs.add(verb);
      for (const verb of verbs)
        for (const dep of closure(edges.verbDepends?.[verb] ?? [], `verbs.${verb}`))
          if (!demanded.has(dep))
            refuse(
              "invalid-graph",
              `stages.${id}.verbs`,
              `Verb ${verb} depends on reading ${dep}, which stage ${id} never demands`,
            );
      // A chord collides within its own scope path: stage chords, then stage chords plus one pane's.
      // Sibling panes are disjoint kit scopes, so they never see each other's chords.
      const checkChord = (scope: Map<string, string>, path: string, verb: string, chord: Chord) => {
        const key = chordKey(chord);
        const prior = scope.get(key);
        if (prior && prior !== verb)
          refuse("chord-conflict", path, `'${prior}' and '${verb}' share '${chord}'`);
        scope.set(key, verb);
      };
      for (const verb of verbs) checkVerb(verb, `stages.${id}.verbs`);
      // The pane head owns refresh; a stage verb that refreshes would draw it twice.
      if (graph.refresh && stage.verbs.includes(graph.refresh))
        refuse(
          "invalid-graph",
          `stages.${id}.verbs`,
          `'${graph.refresh}' is the pane head's refresh`,
        );
      if (stage.verbs.filter((verb) => graph.verbs[verb]?.primary).length > 1)
        refuse("invalid-graph", `stages.${id}.verbs`, "A stage frames at most one primary verb");
      const stageScope = new Map<string, string>();
      for (const verb of stage.verbs) {
        const chord = graph.verbs[verb]?.chord;
        if (chord) checkChord(stageScope, `stages.${id}.chords`, verb, chord);
      }
      for (const [verb, chord] of Object.entries(stage.chords ?? {})) {
        checkVerb(verb, `stages.${id}.chords`);
        checkChord(stageScope, `stages.${id}.chords`, verb, chord);
      }
      for (const paneId of stage.panes) {
        const declared = Object.hasOwn(graph.panes, paneId) ? graph.panes[paneId] : undefined;
        if (!declared) continue;
        const paneScope = new Map(stageScope);
        const path = `panes.${paneId}.chords`;
        for (const verb of placedIds(declared.verbs)) {
          const chord = graph.verbs[verb]?.chord;
          if (chord) checkChord(paneScope, path, verb, chord);
        }
        for (const [verb, chord] of Object.entries(declared.chords ?? {})) {
          checkVerb(verb, path);
          checkChord(paneScope, path, verb, chord);
        }
      }
    }
    if (graph.work && Object.hasOwn(graph.verbs, START_FRESH_VERB))
      refuse(
        "reserved-verb",
        `verbs.${START_FRESH_VERB}`,
        `'${START_FRESH_VERB}' is a kernel verb id`,
      );
    if (graph.work && Object.hasOwn(graph.verbs, SALVAGE_VERB))
      refuse("reserved-verb", `verbs.${SALVAGE_VERB}`, `'${SALVAGE_VERB}' is a kernel verb id`);
    if (graph.salvage && !graph.work)
      refuse("invalid-graph", "salvage", "Only a graph with Work can carry salvage over");
    for (const id of graph.observe ?? []) {
      if (!graph.work || !graph.verbs[id] || graph.verbs[id]!.review !== "none")
        refuse(
          "invalid-graph",
          "observe",
          "Automatic Work observation requires a declared review-free verb",
        );
    }
    if (graph.workSubject !== undefined) {
      if (!graph.work)
        refuse("invalid-graph", "workSubject", "Only a graph with Work can select it by subject");
      if (!Object.hasOwn(graph.fields, graph.workSubject))
        refuse("invalid-graph", "workSubject", `Unknown Page field '${graph.workSubject}'`);
    }
    for (const [id, verb] of Object.entries(graph.verbs)) {
      if (!["work", "command", "query", "recovery", "page"].includes(verb.kind))
        refuse("invalid-graph", `verbs.${id}.kind`, "Unknown verb kind");
      if (verb.kind === "page" && (verb.review !== "none" || verb.subject || verb.does))
        refuse(
          "invalid-graph",
          `verbs.${id}`,
          "A Page verb has no Work subject, command, or review",
        );
      if (verb.selects === "work" && graph.workSubject === undefined)
        refuse("invalid-graph", `verbs.${id}`, "A query that selects Work needs `workSubject`");
      if (verb.kind === "recovery")
        refuse("reserved-verb", `verbs.${id}`, "Recovery verbs are kernel-owned");
    }
    const families = new Set<string>();
    const shape = graph.work ? unwrapSchema(graph.work).shape : undefined;
    for (const [index, family] of (graph.cells ?? []).entries()) {
      const path = `cells.${index}`;
      const type = cellSubjectType(family);
      if (family.segment === null && !family.key)
        refuse("invalid-graph", path, "A root cell needs a key");
      if (families.has(type)) refuse("invalid-graph", path, `Duplicate cell family '${type}'`);
      families.add(type);
      for (const kind of CELL_VERB_KINDS) {
        const id = cellVerbId(family, kind);
        if (Object.hasOwn(graph.verbs, id))
          refuse("reserved-verb", `verbs.${id}`, `'${id}' is a kernel cell verb id`);
      }
      const name = family.segment ?? family.key ?? "";
      const held = shape && Object.hasOwn(shape, name) ? shape[name] : undefined;
      if (!held)
        refuse("missing-segment", path, `The Work schema has no '${name}' to hold these cells`);
      else if (family.segment !== null && unwrapSchema(held).type !== "record")
        refuse("missing-segment", path, `Work '${name}' must be a keyed record of cells`);
    }
    const seen = new Set<LayoutNode>();
    const walk = (node: LayoutNode) => {
      if (seen.has(node)) {
        refuse(
          "invalid-graph",
          "layout",
          "Layout must be a tree, without repeated nodes or cycles",
        );
        return;
      }
      seen.add(node);
      switch (node.kind) {
        case "pane":
          if (!Object.hasOwn(graph.panes, node.id))
            refuse("missing-pane", "layout", `Unknown pane '${node.id}'`);
          break;
        case "gate":
          if (
            !Object.hasOwn(graph.stages, node.when) &&
            !Object.hasOwn(graph.predicates ?? {}, node.when)
          )
            refuse("unknown-gate", "layout", `Unknown stage or predicate '${node.when}'`);
          walk(node.child);
          break;
        case "split":
          if (node.children.length < 2)
            refuse("invalid-graph", "layout", `Split '${node.id}' needs two children`);
          for (const child of node.children) walk(child);
          break;
        default:
          refuse("invalid-graph", "layout", "Unknown layout node kind");
      }
    };
    walk(graph.layout);
    const stages = Object.keys(graph.stages);
    const order = graph.stageOrder ?? stages;
    if (
      graph.stageOrder !== undefined &&
      (!order.length ||
        order.length !== stages.length ||
        new Set(order).size !== stages.length ||
        order.some((id) => !Object.hasOwn(graph.stages, id)))
    )
      refuse(
        "stage-order",
        "stageOrder",
        "Stages must form one nonempty order containing every stage exactly once",
      );
  } catch (cause) {
    refuse(
      "invalid-graph",
      "graph",
      cause instanceof Error ? cause.message : "Malformed route graph",
    );
  }
  return refusals;
}
/** Author only deviations from the subject's ordinary read and presentation contract. */
export type GraphDeclaration<P, W = unknown> = Omit<
  RouteGraph<P, W>,
  "subjectField" | "fields" | "readings" | "panes" | "stages"
> & {
  fields: {
    readonly [K in keyof P]-?: FieldDecl<z.ZodType<P[K]>> & { role?: FieldRole };
  } & Readonly<Record<string, FieldDecl & { role?: FieldRole }>>;
  subjectField: Omit<RouteGraph<P, W>["subjectField"], "cardinality" | "show"> &
    Partial<Pick<RouteGraph<P, W>["subjectField"], "cardinality" | "show">>;
  readings: Readonly<Record<string, Partial<ReadingDecl<P>>>>;
  panes: Readonly<
    Record<string, Omit<PaneDecl, "draws" | "verbs"> & Partial<Pick<PaneDecl, "draws" | "verbs">>>
  >;
  stages: Readonly<
    Record<string, Omit<StageDecl, "panes" | "verbs"> & Partial<Pick<StageDecl, "panes" | "verbs">>>
  >;
};

/** Expand once, before admission, hashing or either client sees the graph. No route-key branches. */
export function defineRouteGraph<P, W = unknown>(
  declaration: GraphDeclaration<P, W>,
): RouteGraph<P, W> {
  const subject = {
    cardinality: "one" as const,
    show: (id: string) => id,
    ...declaration.subjectField,
  };
  const readings: Record<string, ReadingDecl<P>> = {};
  for (const [id, reading] of Object.entries(declaration.readings))
    readings[id] = {
      kind: "use",
      source: `${declaration.key}.${id}`,
      retire: reading.args ? "page" : "target",
      ...reading,
    };
  // A shared roster/detail is a single target-scoped read, not a duplicate page read.
  readings[subject.roster] ??= {
    kind: "use",
    source: `${declaration.key}.${subject.roster}`,
    retire: "target",
  };
  readings[subject.detail] ??= {
    kind: "use",
    source: `${declaration.key}.${subject.detail}`,
    retire: "page",
    args: (page) => page[subject.field],
  };
  const panes = Object.fromEntries(
    Object.entries(declaration.panes).map(([id, pane]) => [
      id,
      { draws: [], verbs: [], ...pane } satisfies PaneDecl,
    ]),
  );
  return {
    ...declaration,
    subjectField: subject,
    // Address codecs and policy already exist; only role exceptions belong in the graph.
    fields: Object.fromEntries(
      Object.entries(declaration.fields).map(([id, field]) => [
        id,
        { role: id === subject.field ? "subject" : id === "stage" ? "stage" : "pose", ...field },
      ]),
    ) as RouteGraph<P, W>["fields"],
    readings,
    panes,
    stages: Object.fromEntries(
      Object.entries(declaration.stages).map(([id, stage]) => [
        id,
        { panes: Object.keys(panes), verbs: [], ...stage } satisfies StageDecl,
      ]),
    ),
  };
}

/** RFC 8785 serialization. Reject before hashing rather than silently erasing data. */
export function canonicalRouteJson(value: unknown): string {
  const active = new Set<object>();
  function encode(value: unknown, path: string): string {
    if (value === null) return "null";
    if (typeof value === "string") {
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))
        throw Error(`${path}: lone surrogate`);
      return JSON.stringify(value);
    }
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
    if (typeof value !== "object") throw Error(`${path}: not a JSON value`);
    if (active.has(value)) throw Error(`${path}: cyclic data`);
    const array = Array.isArray(value);
    if (
      !array &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw Error(`${path}: not a plain JSON object`);
    active.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length) throw Error(`${path}: symbol member`);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === "length") continue;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
        throw Error(`${path}.${key}: non-data member`);
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))
        throw Error(`${path}.${key}: extra array member`);
    }
    const result = array
      ? `[${Array.from({ length: value.length }, (_, i) => encode(descriptors[String(i)]?.value, `${path}.${i}`)).join(",")}]`
      : `{${Object.keys(descriptors)
          .sort()
          .map((key) => `${encode(key, path)}:${encode(descriptors[key]!.value, `${path}.${key}`)}`)
          .join(",")}}`;
    active.delete(value);
    return result;
  }
  return encode(value, "data");
}
