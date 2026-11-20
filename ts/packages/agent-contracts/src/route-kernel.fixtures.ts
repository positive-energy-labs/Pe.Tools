import { z } from "zod";
import type { RouteGraphJson } from "./route-kernel-data.ts";
import type { BodyBindings, EntryTable } from "./route-kernel-bodies.ts";
import type { RouteModule, RouteFingerprintInput } from "./route-kernel-admission.ts";
import type { CodecBindings } from "./route-kernel-bodies.ts";
import { jsonCodec } from "./route-kernel-codecs.ts";
import { decode, subjectRefCodeSchema } from "./subject-ref.ts";

const localId = subjectRefCodeSchema;
/** A pod's manual circuit is a `group` SubjectRef, a modelled one a `UniqueId`; keyKind is the tag. */
const mixedSubject = subjectRefCodeSchema;
const isManual = (code: string | null) => {
  const ref = code === null ? null : decode(code);
  return ref?.ok === true && ref.value.keyKind === "group";
};
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
  work: z.strictObject({ amount: z.number(), note: z.string() }),
  edit: z.strictObject({ amount: z.number() }),
  empty: z.strictObject({}),
  result: z.strictObject({ total: z.number() }),
  viewport: z.strictObject({ x: z.number(), y: z.number() }),
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
  fields: {
    system: {
      role: "subject",
      schema: "subjectOne",
      codec: "subject",
      initial: null,
      cardinality: "one",
      picker: { reading: "roster", options: "pick" },
      ...policy,
    },
    selected: { role: "selection", kinds: ["system", "element"] },
    density: {
      role: "device",
      schema: "number",
      codec: "number",
      initial: 1,
      url: false,
      share: false,
      agent: "read",
    },
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
/** The value a reading holds, for a body that draws over a value-less state too. */
const held = <T>(reading: import("./route-kernel-bodies.ts").ReadingState<T>) =>
  "value" in reading ? reading.value : undefined;
const source = { module: "bodies.js", export: "bodies" } as const;
export const builtinBodies = {
  pick: {
    slot: "fields.system.picker.options",
    kind: "picker",
    source,
    run: (reading) => held(reading)?.map((s) => ({ id: s.id, label: s.name })) ?? [],
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
    run: ({ work, readings }) => ({ total: work.amount * (held(readings.roster)?.length ?? 1) }),
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
    run: ({ work, captures }) => ({ amount: held(captures.total)?.total ?? work.amount }),
  },
  main: {
    slot: "panes.main.body",
    kind: "pane",
    source,
    run: ({ page, readings }) => `${page.read().system}: ${held(readings.total)?.total}`,
  },
} satisfies BodyBindings<typeof builtinData, typeof schemas, typeof entries, string>;

// Complete representative Pod: manual/native subjects, typed cell key and bindings.
export const podData = {
  ...builtinData,
  capabilities: ["work", "native-write", "geometry"],
  key: "pod.circuits",
  address: "/pod/circuits",
  name: "Circuit calculator",
  fields: {
    ...builtinData.fields,
    system: {
      ...builtinData.fields.system,
      schema: "mixedSubject",
    },
    selected: { role: "selection", kinds: ["manual", "circuit"] },
  },
  work: { schema: "work", route: "pod.circuits", version: 2 },
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
    run: (reading) => held(reading)?.map((s) => ({ id: s.id, label: s.name })) ?? [],
  },
  rosterArgs: { ...builtinBodies.rosterArgs, run: ({ page }) => ({ filter: page.search }) },
  calculate: {
    ...builtinBodies.calculate,
    run: ({ page, work, readings }) => ({
      total: isManual(page.system)
        ? work.amount
        : work.amount * (held(readings.roster)?.length ?? 1),
    }),
  },
  edit: {
    ...builtinBodies.edit,
    run: (_ctx, input) => [{ path: ["amount"], value: input.amount }],
  },
  apply: {
    ...builtinBodies.apply,
    run: ({ work, captures }) => ({ amount: held(captures.total)?.total ?? work.amount }),
  },
  main: {
    ...builtinBodies.main,
    run: ({ page }) => (isManual(page.read().system) ? "manual" : "none"),
  },
  cellGroup: {
    slot: "cells.input.groupOf",
    kind: "group",
    source,
    run: (key) => [key === "voltage" ? "electrical" : "layout"],
  },
  cellFocus: { slot: "cells.input.focus", kind: "focus", source, run: (key) => ({ search: key }) },
} satisfies BodyBindings<typeof podData, typeof schemas, typeof podEntries, string>;

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
  artifact: artifact(builtinData),
} satisfies RouteModule<typeof builtinData, typeof schemas, typeof entries, string>;
export const podModule = {
  data: podData,
  schemas,
  entries: podEntries,
  bodies: podBodies,
  codecs: { ...builtinCodecs, subject: jsonCodec(schemas.mixedSubject) },
  artifact: artifact(podData),
} satisfies RouteModule<typeof podData, typeof schemas, typeof podEntries, string>;

// Only cardinality differs; shipped routes carry the large authoring graphs.
export const multiSubjectData = {
  ...builtinData,
  fields: {
    ...builtinData.fields,
    system: {
      ...builtinData.fields.system,
      cardinality: "many",
      schema: "subjectMany",
      initial: { kind: "ids", ids: [] },
    },
  },
} as const satisfies RouteGraphJson;
