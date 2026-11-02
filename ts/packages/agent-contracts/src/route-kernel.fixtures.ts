import { z } from "zod";
import type { RouteGraphJson } from "./route-kernel-data.ts";
import type { BodyBindings, EntryTable } from "./route-kernel-bodies.ts";
import type { IdentityId } from "./route-kernel-page.ts";

// Fixture schema only. C implements the shared identity codecs used by real authors.
const localId = z.custom<IdentityId<"local">>((text: unknown) => {
  if (typeof text !== "string") return false;
  try {
    const parts: unknown = JSON.parse(text);
    return (
      Array.isArray(parts) &&
      parts.length === 2 &&
      parts.every((p) => typeof p === "string" && p.length > 0) &&
      JSON.stringify(parts) === text
    );
  } catch {
    return false;
  }
});
export const schemas = {
  subjectOne: localId.nullable(),
  subjectMany: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("ids"), ids: z.array(localId) }),
    z.strictObject({ kind: z.literal("all") }),
  ]),
  text: z.string(),
  number: z.number(),
  flag: z.boolean(),
  work: z.strictObject({ amount: z.number(), note: z.string() }),
  edit: z.strictObject({ amount: z.number() }),
  empty: z.strictObject({}),
  result: z.strictObject({ total: z.number() }),
  viewport: z.strictObject({ x: z.number(), y: z.number() }),
  sort: z.strictObject({ columns: z.array(z.string()) }),
};
export const entries = {
  roster: {
    input: z.strictObject({ filter: z.string() }),
    output: z.array(z.strictObject({ id: localId, name: z.string() })),
    axes: {
      subject: "None",
      touches: ["Metadata"],
      effect: "Read",
      cost: "Cheap",
      cardinality: "One",
    },
  },
  apply: {
    input: z.strictObject({ amount: z.number() }),
    output: z.strictObject({ changed: z.number() }),
    axes: {
      subject: "None",
      touches: ["Metadata"],
      effect: "ModelWrite",
      cost: "Mutation",
      cardinality: "One",
    },
  },
} as const satisfies EntryTable;
const emptyDeps = { page: [], work: [], readings: [] } as const;
const readingPolicy = {
  demand: "subject",
  retain: { evidence: "scope", resource: "visible" },
  refresh: "dependencies",
} as const;
const policy = { url: "replace", share: true, agent: "set" } as const;
const text = { role: "query", schema: "text", codec: "text", initial: "", ...policy } as const;
const sort = {
  role: "query",
  schema: "sort",
  codec: "sort",
  initial: { columns: [] },
  ...policy,
} as const;
export const builtinData = {
  version: 1,
  key: "tiny",
  address: "/tiny",
  name: "Tiny",
  directory: { group: "test", summary: "Signature witness" },
  identities: {
    system: { kind: "local", codec: "local" },
    element: { kind: "element", codec: "element" },
  },
  fields: {
    system: {
      role: "subject",
      schema: "subjectOne",
      codec: "subject",
      initial: null,
      cardinality: "one",
      identity: "system",
      picker: { reading: "roster", options: "pick" },
      ...policy,
    },
    selected: { role: "selection", kinds: ["system", "element"] },
    density: { role: "setting", schema: "number", codec: "number", initial: 1 },
    viewport: {
      role: "pose",
      schema: "viewport",
      codec: "viewport",
      initial: { x: 0, y: 0 },
      ...policy,
    },
    search: text,
  },
  subject: { field: "system", noun: "system", roster: "roster", detail: "total", pane: "main" },
  work: { schema: "work", route: "tiny", version: 1 },
  readings: {
    roster: {
      kind: "use",
      entry: "roster",
      args: "rosterArgs",
      deps: { ...emptyDeps, page: ["search"] },
      ...readingPolicy,
    },
    total: {
      kind: "derive",
      output: "result",
      derive: "calculate",
      deps: { page: ["system"], work: ["amount"], readings: ["roster"] },
      ...readingPolicy,
    },
  },
  verbs: {
    edit: {
      kind: "work",
      input: "edit",
      label: "Edit",
      review: "none",
      deps: emptyDeps,
      captures: [],
      patches: "edit",
    },
    apply: {
      kind: "command",
      input: "empty",
      label: "Apply",
      review: "shown",
      deps: { ...emptyDeps, work: ["amount"] },
      captures: ["total"],
      entry: "apply",
      intent: "apply",
    },
  },
  panes: {
    main: {
      label: "Main",
      purpose: "Inspect",
      draws: ["total"],
      verbs: ["edit", "apply"],
      body: "main",
    },
  },
  layout: { kind: "pane", id: "main" },
  stages: { inspect: { word: "Inspect", panes: ["main"], verbs: ["edit", "apply"] } },
  stageOrder: ["inspect"],
  predicates: {},
  cells: {},
  workFields: {},
  seeds: {},
  needs: "nothing",
  resetOnTarget: [],
  observe: [],
} as const satisfies RouteGraphJson;
const source = { module: "bodies.js", export: "bodies" } as const;
export const builtinBodies = {
  pick: {
    slot: "fields.system.picker.options",
    kind: "picker",
    source,
    run: (reading) => reading.value?.map((s) => ({ id: s.id, label: s.name })) ?? [],
  },
  rosterArgs: {
    slot: "readings.roster.args",
    kind: "args",
    source,
    run: ({ page }) => ({ filter: page.search }),
  },
  calculate: {
    slot: "readings.total.derive",
    kind: "derive",
    source,
    run: ({ work, readings }) => ({ total: work.amount * (readings.roster.value?.length ?? 1) }),
  },
  edit: {
    slot: "verbs.edit.patches",
    kind: "work",
    source,
    run: (_ctx, input) => [{ path: ["amount"], value: input.amount }],
  },
  apply: {
    slot: "verbs.apply.intent",
    kind: "intent",
    source,
    run: ({ work }) => ({ amount: work.amount }),
  },
  main: {
    slot: "panes.main.body",
    kind: "pane",
    source,
    run: ({ page, readings }) => `${page.read().system}: ${readings.total.value?.total}`,
  },
} satisfies BodyBindings<typeof builtinData, typeof schemas, typeof entries, string>;

// A checked Pod uses the identical contract. No register(api), privileged executor or TS generation.
export const podData = {
  ...builtinData,
  key: "pod.circuits",
  address: "/pod/circuits",
  name: "Circuit calculator",
  work: { schema: "work", route: "pod.circuits", version: 2 },
} as const satisfies RouteGraphJson;
export const podBodies = {
  ...builtinBodies,
  calculate: {
    slot: "readings.total.derive",
    kind: "derive",
    source,
    run: ({ page, work, readings }) => ({
      total:
        page.system === null ? work.amount : work.amount * (readings.roster.value?.length ?? 1),
    }),
  },
} satisfies BodyBindings<typeof podData, typeof schemas, typeof entries, string>;

// Twenty-six actual field declarations stress declaration emit, not a generated numeric range.
export const ductsData = {
  ...builtinData,
  key: "ducts-witness",
  address: "/ducts-witness",
  fields: {
    ...builtinData.fields,
    system: {
      ...builtinData.fields.system,
      cardinality: "many",
      schema: "subjectMany",
      initial: { kind: "ids", ids: [] },
    },
    stage: { ...text, role: "stage", initial: "network" },
    threadSearch: text,
    threadSort: sort,
    systemSearch: text,
    systemSort: sort,
    rulingSearch: text,
    rulingSort: sort,
    treeSearch: text,
    treeSort: sort,
    inputSearch: text,
    inputSort: sort,
    contextRadiusFt: { ...builtinData.fields.density, initial: 50 },
    sceneView: { ...text, role: "pose" },
    encoding: { ...text, role: "pose" },
    layers: { ...sort, role: "pose" },
    contextStyle: { ...text, role: "pose" },
    picture: { ...text, role: "pose" },
    showLabels: { role: "setting", schema: "flag", codec: "flag", initial: true },
    draftName: { ...text, role: "draft" },
    panel: { ...text, role: "device", url: false, share: false },
    review: { ...text, role: "transient", url: false, share: false },
  },
} as const satisfies RouteGraphJson;
export const ductsBodies = {
  ...builtinBodies,
  rosterArgs: { ...builtinBodies.rosterArgs, run: ({ page }) => ({ filter: page.search }) },
  edit: {
    ...builtinBodies.edit,
    run: (_ctx, input) => [{ path: ["amount"], value: input.amount }],
  },
  apply: { ...builtinBodies.apply, run: ({ work }) => ({ amount: work.amount }) },
  calculate: {
    slot: "readings.total.derive",
    kind: "derive",
    source,
    run: ({ page, work }) => ({
      total: work.amount * (page.system.kind === "all" ? 1 : page.system.ids.length),
    }),
  },
  main: {
    slot: "panes.main.body",
    kind: "pane",
    source,
    run: ({ page }) => {
      page.set("contextRadiusFt", 80);
      return page.read().stage;
    },
  },
} satisfies BodyBindings<typeof ductsData, typeof schemas, typeof entries, string>;
