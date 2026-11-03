import type { RouteModule } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import { z } from "zod";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { IdentityId } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { captureReceiptSchema } from "../../../../packages/agent-contracts/src/capture";
import { identityCodecs } from "../shell/page-port";

export const capturesData = {
  version: 1,
  key: "captures",
  address: "/captures",
  name: "Captures",
  directory: {
    group: "Coordinate model data",
    summary: "Inspect retained view pictures and receipts",
  },
  identities: { capture: { kind: "local", codec: "local" } },
  fields: {
    sha: {
      role: "subject",
      schema: "subject",
      codec: "subject",
      initial: null,
      cardinality: "one",
      identity: "capture",
      picker: { reading: "captures", options: "pick" },
      url: "push",
      share: true,
      agent: "set",
    },
    selected: { role: "selection", kinds: ["capture"] },
    open: {
      role: "pose",
      schema: "open",
      codec: "json",
      initial: { kind: "ids", ids: [] },
      url: "replace",
      share: true,
      agent: "set",
    },
  },
  subject: {
    field: "sha",
    noun: "capture",
    roster: "captures",
    detail: "captures",
    pane: "captures",
  },
  readings: {
    captures: {
      kind: "use",
      entry: "captures.list",
      deps: { page: [], work: [], readings: [] },
      demand: "visible",
      retain: { evidence: "scope", resource: "scope" },
      refresh: "explicit",
    },
  },
  verbs: {},
  panes: {
    captures: {
      label: "Captures",
      purpose: "Inspect retained pictures",
      draws: ["captures"],
      verbs: [],
      body: "main",
    },
  },
  layout: { kind: "pane", id: "captures" },
  stages: { main: { word: "Captures", panes: ["captures"], verbs: [] } },
  stageOrder: ["main"],
  predicates: {},
  cells: {},
  workFields: {},
  seeds: { browse: { title: "Retained view picture", load: "browse" } },
  needs: "nothing",
  resetOnTarget: [],
  observe: [],
} as const satisfies RouteGraphJson;
const local = z.custom<IdentityId<"local">>(
  (v) => typeof v === "string" && identityCodecs.local.decode(v).ok,
);
export const schemas = {
  subject: local.nullable(),
  open: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ids"), ids: z.array(z.string()) }),
    z.object({ kind: z.literal("all") }),
  ]),
};
export const entries = {
  "captures.list": {
    input: z.object({}),
    output: z.array(captureReceiptSchema),
    axes: {
      subject: "None",
      touches: ["Metadata"],
      effect: "Read",
      cost: "Cheap",
      cardinality: "One",
    },
  },
} as const;
export const captureId = (sha: string) => {
  const id = identityCodecs.local.encode({ namespace: "captures", subject: sha });
  if (!id.ok) throw Error(id.reason);
  return id.value;
};
const source = { module: "route.js", export: "module" };
export const bodies = {
  browse: {
    slot: "seeds.browse.load",
    kind: "seed",
    source,
    run: () => ({
      readings: {
        captures: [
          {
            id: "capture-plan",
            sha: "a".repeat(64),
            at: "2026-10-01T00:00:00Z",
            origin: "web:/rooms",
            document: { title: "Clinic" },
            view: { name: "Ground plan" },
            focus: null,
            registration: null,
            byteSize: 1,
            url: "/captures/fixture.png",
          },
        ],
      },
    }),
  },
  pick: {
    slot: "fields.sha.picker.options",
    kind: "picker",
    source,
    run: (reading) =>
      reading.current
        ? reading.value.map((c) => ({ id: captureId(c.sha), label: c.view.name ?? "view" }))
        : [],
  },
  main: {
    slot: "panes.captures.body",
    kind: "pane",
    source,
    run: (ctx) => ({ reading: ctx.readings.captures, page: ctx.page.read() }),
  },
} satisfies BodyBindings<typeof capturesData, typeof schemas, typeof entries>;
export const module = {
  data: capturesData,
  schemas,
  entries,
  bodies,
  identities: { local: identityCodecs.local },
  codecs: {
    subject: {
      encode: (value: z.output<typeof schemas.subject>) => JSON.stringify(value),
      decode: (text: string) => {
        try {
          const value = schemas.subject.parse(JSON.parse(text));
          return { ok: true as const, value };
        } catch {
          return { ok: false as const, reason: "Invalid capture subject" };
        }
      },
    },
    json: {
      encode: (value: z.output<typeof schemas.open>) => JSON.stringify(value),
      decode: (text: string) => {
        try {
          return { ok: true as const, value: schemas.open.parse(JSON.parse(text)) };
        } catch {
          return { ok: false as const, reason: "Invalid open captures" };
        }
      },
    },
  },
} satisfies Omit<RouteModule<typeof capturesData, typeof schemas, typeof entries>, "artifact">;
