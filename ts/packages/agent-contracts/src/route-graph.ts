import { z } from "zod";
import type { History, RouteField } from "./route-field.ts";
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
  Partial<FieldPolicy> & { label?: string; control?: "color"; editor?: "pane" };

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
  /** The answer a required review needs, when the declaration states it for Pea. */
  answers?: z.ZodType;
  subject?: string;
  input: S;
  review: "none" | "shown" | "required";
  chord?: Chord;
  label: string;
  says?: string;
  effect?: "query" | "command";
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

/** The kernel-owned lifecycle verbs of a Work's authored cells; their ids are reserved. */
export const CELL_VERB_KINDS = ["take", "reject", "reopen", "delete"] as const;
export type CellVerbKind = (typeof CELL_VERB_KINDS)[number];

/** One family of authored cells in a route's Work, as the Situation and the Chat head read it. */
export interface CellsDecl<W = unknown> {
  /** Extra patches accepted with a proposal, in the same CAS write and inverse journal step. */
  take?: (
    doc: W,
    key: string,
    readings: Readonly<Record<string, { value?: unknown; current: boolean }>>,
  ) => readonly RouteStatePatch[];
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
  review: "required",
  input: z.strictObject({}).default({}),
  answers: z.strictObject({ confirm: z.literal(true) }),
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
  review: "required",
  input: z.strictObject({}).default({}),
  answers: z.strictObject({ confirm: z.literal(true) }),
} as const satisfies VerbDecl;

export interface RouteGraph<P = Record<string, unknown>, W = unknown> {
  key: string;
  address: string;
  name: string;
  fields: {
    readonly [K in keyof P]-?: FieldDecl<z.ZodType<P[K]>> & { role: FieldRole };
  } & Readonly<Record<string, FieldDecl & { role: FieldRole }>>;
  readings: Readonly<Record<string, ReadingDecl<P>>>;
  verbs: Readonly<Record<string, VerbDecl>>;
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
  /** Authored segments of the Work; the kernel owns take, reject, reopen and delete for them. */
  cells?: readonly CellsDecl<W>[];
  pick?: false;
  transition?: GraphTransition<P>;
  predicates?: Readonly<Record<string, (page: Readonly<P>, work: W | null) => boolean>>;
  /** Defaults to stage declaration order. The projection retains it despite sorting map keys. */
  stageOrder?: readonly string[];
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
  readonly key: string;
  readonly address: string;
  readonly name: string;
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
  readonly cells?: readonly GraphJsonObject[];
  readonly stageOrder: readonly string[];
  readonly pick?: false;
  readonly transition?: GraphJsonObject;
  readonly predicates?: Readonly<Record<string, GraphJsonObject>>;
}

function sortedJson(value: unknown): GraphJsonValue {
  // Installed Zod 4 owns JSON Schema conversion. Input direction retains preprocessing inputs.
  if (value instanceof z.ZodType) return sortedJson(z.toJSONSchema(value, { io: "input" }));
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

/** Collects admission refusals without running route code. Malformed runtime data also refuses. */
export function validateRouteGraph<P, W>(graph: RouteGraph<P, W>): RouteGraphRefusal[] {
  const refusals: RouteGraphRefusal[] = [];
  const refuse = (code: RouteGraphRefusal["code"], path: string, message: string) => {
    // A pane shared by several stages is checked once per stage; say each refusal once.
    if (!refusals.some((r) => r.code === code && r.path === path && r.message === message))
      refusals.push({ code, path, message });
  };
  try {
    const checkVerb = (id: string, path: string) => {
      if (!Object.hasOwn(graph.verbs, id)) refuse("missing-verb", path, `Unknown verb '${id}'`);
    };
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
      (graph.pick === false || graph.stageOrder !== undefined) &&
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
