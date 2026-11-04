import {
  z,
  type PodRouteAuthoring,
} from "../../../../../ts/packages/agent-contracts/src/pod-authoring.ts";
import type { RouteGraphJson } from "../../../../../ts/packages/agent-contracts/src/route-kernel-data.ts";
import type { BodyBindings } from "../../../../../ts/packages/agent-contracts/src/route-kernel-bodies.ts";
import type {
  IdentityCodec,
  IdentityId,
} from "../../../../../ts/packages/agent-contracts/src/route-kernel-page.ts";
import { calculate, sizes } from "../../pages/tour/calc.mjs";

const namespace = "snowdon-circuits";
const subjectId = JSON.stringify([namespace, "voltage-drop"]) as IdentityId<"local">;
const localParts = z.tuple([z.literal(namespace), z.literal("voltage-drop")]);
const subject = z.custom<IdentityId<"local">>((value) => {
  if (typeof value !== "string") return false;
  try {
    return JSON.stringify(localParts.parse(JSON.parse(value))) === value;
  } catch {
    return false;
  }
});
const local: IdentityCodec<"local"> = {
  kind: "local",
  encode: (parts) => local.decode(JSON.stringify([parts.namespace, parts.subject])),
  decode: (text) =>
    subject.safeParse(text).success
      ? { ok: true, value: text as IdentityId<"local"> }
      : { ok: false, reason: "Unknown calculation worksheet" },
  parts: (id) => {
    const [namespace, subject] = localParts.parse(JSON.parse(id));
    return { namespace, subject };
  },
};
export const initial = { size: "10", length: 150, amps: 24, voltage: 208, phase: "3" } as const;
const inputs = z.strictObject({
  size: z.enum(sizes.map((row) => String(row.size))),
  length: z.number().nonnegative(),
  amps: z.number().nonnegative(),
  voltage: z.number().positive(),
  phase: z.enum(["1", "3"]),
});
export const schemas = {
  subject: subject.nullable(),
  roster: z.array(z.strictObject({ id: subject, name: z.string() })),
  work: z.strictObject({ version: z.literal(2).default(2), inputs: inputs.default(initial) }),
  edit: inputs,
  result: z.strictObject({
    drop: z.number(),
    percent: z.number(),
    delivered: z.number(),
    area: z.number(),
    multiplier: z.number(),
  }),
};
const deps = { page: [], work: [], readings: [] } as const;
const reading = {
  demand: "subject",
  retain: { evidence: "scope", resource: "visible" },
  refresh: "dependencies",
} as const;
export const data = {
  version: 1,
  capabilities: ["work"],
  key: "pod.snowdon-circuits.voltage-drop",
  address: "/tool/route:@snowdon-circuits/routes/voltage-drop/route.artifact",
  name: "Circuit voltage drop",
  directory: {
    group: "Calculate loads & airflow",
    summary: "Compare authored copper conductor inputs with the 75 C K method",
    label: "Circuits",
    icon: "Boxes",
    exposure: "Main",
    surfaces: { web: "full", pwa: "full", tray: false },
    aliases: ["voltage", "conductor"],
    runtimeNeed: "Host",
    listed: true,
    satellites: [],
  },
  identities: { worksheet: { kind: "local", codec: "local" } },
  fields: {
    worksheet: {
      role: "subject",
      schema: "subject",
      codec: "subject",
      initial: subjectId,
      cardinality: "one",
      identity: "worksheet",
      picker: { reading: "worksheets", options: "pick" },
      url: "push",
      share: true,
      agent: "set",
    },
    selected: { role: "selection", kinds: ["worksheet"] },
  },
  subject: {
    field: "worksheet",
    noun: "Calculation worksheet",
    roster: "worksheets",
    detail: "calculation",
    pane: "calculation",
    show: "show",
  },
  work: {
    route: "pod.snowdon-circuits.voltage-drop",
    schema: "work",
    version: 2,
    migrations: { "1": "upgradeV1" },
  },
  readings: {
    worksheets: { kind: "derive", output: "roster", derive: "worksheets", deps, ...reading },
    calculation: {
      kind: "derive",
      output: "result",
      derive: "calculate",
      deps: { page: ["worksheet"], work: ["inputs"], readings: [] },
      ...reading,
    },
  },
  verbs: {
    input: {
      kind: "work",
      input: "edit",
      label: "Edit calculation inputs",
      review: "none",
      deps,
      captures: [],
      patches: "edit",
    },
  },
  panes: {
    calculation: {
      label: "Voltage drop",
      purpose: "Compare authored conductor inputs",
      draws: ["calculation"],
      verbs: ["input"],
      body: "main",
    },
  },
  layout: { kind: "pane", id: "calculation" },
  stages: { calculate: { word: "Calculate", panes: ["calculation"], verbs: ["input"] } },
  stageOrder: ["calculate"],
  predicates: {},
  cells: {},
  workFields: { inputs: { label: "Calculation inputs", internal: false } },
  seeds: {},
  needs: "nothing",
  resetOnTarget: [],
  observe: [],
} as const satisfies RouteGraphJson;
const source = { module: "route.js", export: "module" } as const;
export const bodies = {
  worksheets: {
    slot: "readings.worksheets.derive",
    kind: "derive",
    source,
    run: () => [{ id: subjectId, name: "Copper voltage-drop worksheet" }],
  },
  pick: {
    slot: "fields.worksheet.picker.options",
    kind: "picker",
    source,
    run: (reading) => reading.value?.map((row) => ({ id: row.id, label: row.name })) ?? [],
  },
  show: {
    slot: "subject.show",
    kind: "show",
    source,
    run: (id) => (id === subjectId ? "Copper voltage-drop worksheet" : "Choose a worksheet"),
  },
  calculate: {
    slot: "readings.calculation.derive",
    kind: "derive",
    source,
    run: ({ work }) => schemas.result.parse(calculate(work.inputs)),
  },
  edit: {
    slot: "verbs.input.patches",
    kind: "work",
    source,
    run: (_ctx, input) => [{ path: ["inputs"], value: input }],
  },
  upgradeV1: {
    slot: "work.migrations.1",
    kind: "migration",
    source,
    run: (raw) => {
      const old = z.object({ state: z.object({ inputs: inputs.partial() }) }).parse(raw);
      return schemas.work.parse({ version: 2, inputs: { ...initial, ...old.state.inputs } });
    },
  },
  main: {
    slot: "panes.calculation.body",
    kind: "pane",
    source,
    run: ({ work, readings }) =>
      JSON.stringify(
        {
          inputs: work?.inputs,
          calculation: readings.calculation.value ?? null,
          basis:
            "Authored inputs; copper K method at 75 C, unity power factor, negligible reactance. No model facts are inferred.",
        },
        null,
        2,
      ),
  },
} satisfies BodyBindings<typeof data, typeof schemas, Record<never, never>, string>;
export const module = {
  data,
  schemas,
  bodies,
  entries: {},
  identities: { local },
  codecs: {
    subject: {
      encode: (id: z.output<typeof schemas.subject>) => id ?? "",
      decode: (text: string) =>
        text === "" ? { ok: true as const, value: null } : local.decode(text),
    },
  },
} satisfies PodRouteAuthoring<typeof data, typeof schemas, Record<never, never>, string>;
