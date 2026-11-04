import { z } from "zod";
import type { RouteGraphJson } from "./route-kernel-data.ts";
import type { BodyBindings, EntryTable } from "./route-kernel-bodies.ts";
import type { RouteModule, RouteFingerprintInput } from "./route-kernel-admission.ts";
import type { CodecBindings } from "./route-kernel-bodies.ts";
import type { DecodeResult, IdentityCodec, IdentityId } from "./route-kernel-page.ts";

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
const linkParts = z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]);
const nativeParts = z.tuple([z.string().min(1), linkParts.nullable(), z.string().min(1)]);
const elementId = z.custom<IdentityId<"element">>((text: unknown) => {
  if (typeof text !== "string") return false;
  try {
    const parts = nativeParts.safeParse(JSON.parse(text));
    return parts.success && JSON.stringify(parts.data) === text;
  } catch {
    return false;
  }
});
const mixedSubject = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("manual"), id: localId }),
  z.strictObject({ kind: z.literal("circuit"), id: elementId }),
]);
export const schemas = {
  mixedSubject: mixedSubject.nullable(),
  cellKey: z.enum(["voltage", "length"]),
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
  capabilities: ["work", "native-write"],
  key: "tiny",
  address: "/tiny",
  name: "Tiny",
  directory: {
    group: "test",
    summary: "Signature witness",
    label: "Witness",
    icon: "Image",
    exposure: "Preview",
    surfaces: { web: "full", pwa: "full", tray: false },
    aliases: [],
    runtimeNeed: "None",
    listed: false,
    satellites: [],
  },
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
  work: { schema: "work", route: "tiny", version: 1, migrations: {} },
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
    run: ({ work, captures }) => ({ amount: captures.total.value?.total ?? work.amount }),
  },
  main: {
    slot: "panes.main.body",
    kind: "pane",
    source,
    run: ({ page, readings }) => `${page.read().system}: ${readings.total.value?.total}`,
  },
} satisfies BodyBindings<typeof builtinData, typeof schemas, typeof entries, string>;

// Complete representative Pod: manual/native subjects, migration, typed cell key and bindings.
export const podData = {
  ...builtinData,
  capabilities: ["work", "native-write", "geometry"],
  key: "pod.circuits",
  address: "/pod/circuits",
  name: "Circuit calculator",
  identities: {
    manual: { kind: "local", codec: "local" },
    circuit: { kind: "element", codec: "element" },
  },
  fields: {
    ...builtinData.fields,
    system: {
      ...builtinData.fields.system,
      identity: ["manual", "circuit"],
      schema: "mixedSubject",
    },
    selected: { role: "selection", kinds: ["manual", "circuit"] },
  },
  work: { schema: "work", route: "pod.circuits", version: 2, migrations: { "1": "upgradeV1" } },
  readings: {
    ...builtinData.readings,
    overview: {
      kind: "use",
      entry: "scene",
      deps: { ...emptyDeps, page: ["system"] },
      ...readingPolicy,
      geometry: { representation: "overview", entry: "scene" },
    },
    detail: {
      kind: "use",
      entry: "scene",
      deps: { ...emptyDeps, page: ["system"] },
      ...readingPolicy,
      demand: "explicit",
      refresh: "explicit",
      geometry: {
        representation: "detailed",
        entry: "scene",
        overview: "overview",
        trigger: "explicit",
        reachFt: 5,
      },
    },
  },
  cells: {
    input: {
      segment: null,
      key: "cellKey",
      value: "number",
      groupOf: "cellGroup",
      focus: "cellFocus",
      take: "cellTake",
      deps: { ...emptyDeps, work: ["amount"] },
    },
  },
} as const satisfies RouteGraphJson;
export const podEntries = {
  ...entries,
  scene: {
    input: schemas.empty,
    output: z.object({ artifact: z.string() }),
    axes: {
      subject: "Elements",
      touches: ["Geometry"],
      effect: "Read",
      cost: "Expensive",
      cardinality: "Many",
    },
  },
  roster: {
    ...entries.roster,
    output: z.array(z.strictObject({ id: mixedSubject, name: z.string() })),
  },
} as const satisfies EntryTable;
export const podBodies = {
  pick: {
    ...builtinBodies.pick,
    run: (reading) => reading.value?.map((s) => ({ id: s.id, label: s.name })) ?? [],
  },
  rosterArgs: { ...builtinBodies.rosterArgs, run: ({ page }) => ({ filter: page.search }) },
  calculate: {
    ...builtinBodies.calculate,
    run: ({ page, work, readings }) => ({
      total:
        page.system?.kind === "manual"
          ? work.amount
          : work.amount * (readings.roster.value?.length ?? 1),
    }),
  },
  edit: {
    ...builtinBodies.edit,
    run: (_ctx, input) => [{ path: ["amount"], value: input.amount }],
  },
  apply: {
    ...builtinBodies.apply,
    run: ({ work, captures }) => ({ amount: captures.total.value?.total ?? work.amount }),
  },
  main: { ...builtinBodies.main, run: ({ page }) => page.read().system?.kind ?? "none" },
  upgradeV1: {
    slot: "work.migrations.1",
    kind: "migration",
    source,
    run: (raw) => ({ amount: z.object({ amount: z.number() }).parse(raw).amount, note: "" }),
  },
  cellGroup: {
    slot: "cells.input.groupOf",
    kind: "group",
    source,
    run: (key) => [key === "voltage" ? "electrical" : "layout"],
  },
  cellFocus: { slot: "cells.input.focus", kind: "focus", source, run: (key) => ({ search: key }) },
  cellTake: {
    slot: "cells.input.take",
    kind: "take",
    source,
    run: ({ work }, key) => [{ path: ["amount"], value: key === "length" ? work.amount : 120 }],
  },
} satisfies BodyBindings<typeof podData, typeof schemas, typeof podEntries, string>;

function decoded<T>(schema: z.ZodType<T>, value: unknown): DecodeResult<T> {
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, reason: parsed.error.message };
}
function jsonCodec<T>(schema: z.ZodType<T>) {
  return {
    encode: (value: T): string => JSON.stringify(value),
    decode: (text: string): DecodeResult<T> => {
      try {
        return decoded(schema, JSON.parse(text));
      } catch {
        return { ok: false, reason: "Invalid JSON" };
      }
    },
  };
}
export const localCodec: IdentityCodec<"local"> = {
  kind: "local",
  encode: (parts) => decoded(localId, JSON.stringify([parts.namespace, parts.subject])),
  decode: (text) => decoded(localId, text),
  parts: (id) => {
    const parts = z.tuple([z.string(), z.string()]).parse(JSON.parse(id));
    return { namespace: parts[0], subject: parts[1] };
  },
};
export const elementCodec: IdentityCodec<"element"> = {
  kind: "element",
  encode: (parts) =>
    decoded(
      elementId,
      JSON.stringify([
        parts.document,
        parts.link
          ? [parts.link.document, parts.link.linkUniqueId, parts.link.linkedDocument]
          : null,
        parts.uniqueId,
      ]),
    ),
  decode: (text) => decoded(elementId, text),
  parts: (id) => {
    const [document, link, uniqueId] = nativeParts.parse(JSON.parse(id));
    return {
      document,
      uniqueId,
      link: link ? { document: link[0], linkUniqueId: link[1], linkedDocument: link[2] } : null,
    };
  },
};
const builtinCodecs = {
  subject: jsonCodec(schemas.subjectOne),
  number: jsonCodec(schemas.number),
  viewport: jsonCodec(schemas.viewport),
  text: jsonCodec(schemas.text),
} satisfies CodecBindings<typeof builtinData, typeof schemas>;
// Envelope shape witness only: A must verify actual packaged bytes, not trust these sample hashes.
function artifact(data: RouteGraphJson): RouteFingerprintInput {
  return {
    version: 1,
    data,
    contracts: [{ id: "kernel-v1", sha256: "0".repeat(64) }],
    executables: [
      {
        client: "shared",
        entry: "bodies.js",
        members: [{ path: "bodies.js", sha256: "1".repeat(64) }],
      },
    ],
  };
}
export const builtinModule = {
  data: builtinData,
  schemas,
  entries,
  bodies: builtinBodies,
  codecs: builtinCodecs,
  identities: { local: localCodec, element: elementCodec },
  artifact: artifact(builtinData),
} satisfies RouteModule<typeof builtinData, typeof schemas, typeof entries, string>;
export const podModule = {
  data: podData,
  schemas,
  entries: podEntries,
  bodies: podBodies,
  codecs: { ...builtinCodecs, subject: jsonCodec(schemas.mixedSubject) },
  identities: { local: localCodec, element: elementCodec },
  artifact: artifact(podData),
} satisfies RouteModule<typeof podData, typeof schemas, typeof podEntries, string>;

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

// A captures-like admitted source needs only declared reads and Page services.
const { work: _readOnlyWork, ...readOnlyBase } = builtinData;
export const readOnlyData = {
  ...readOnlyBase,
  capabilities: [],
  readings: {
    ...builtinData.readings,
    total: {
      ...builtinData.readings.total,
      deps: { ...builtinData.readings.total.deps, work: [] },
    },
  },
  verbs: {},
  panes: { main: { ...builtinData.panes.main, verbs: [] } },
  stages: { inspect: { ...builtinData.stages.inspect, verbs: [] } },
} as const satisfies RouteGraphJson;
export const readOnlyModule = {
  ...builtinModule,
  data: readOnlyData,
  entries: { roster: entries.roster },
  bodies: {
    pick: builtinBodies.pick,
    rosterArgs: builtinBodies.rosterArgs,
    calculate: { ...builtinBodies.calculate, run: () => ({ total: 0 }) },
    main: { ...builtinBodies.main, run: () => "Read only" },
  },
  artifact: artifact(readOnlyData),
} satisfies RouteModule<
  typeof readOnlyData,
  typeof schemas,
  { roster: typeof entries.roster },
  string
>;
