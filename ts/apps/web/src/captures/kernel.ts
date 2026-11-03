import { z } from "zod";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { IdentityId } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { captureReceiptSchema } from "../../../../packages/agent-contracts/src/capture";
import { identityCodecs } from "../shell/page-port";

export const capturesData = {
  version: 1, key: "captures", address: "/captures", name: "Captures",
  directory: { group: "Coordinate model data", summary: "Inspect retained view pictures and receipts" },
  identities: { capture: { kind: "local", codec: "local" } },
  fields: {
    sha: { role: "subject", schema: "subject", codec: "subject", initial: null,
      cardinality: "one", identity: "capture", picker: { reading: "captures", options: "pick" },
      url: "push", share: true, agent: "set" },
    selected: { role: "selection", kinds: ["capture"] },
    open: { role: "pose", schema: "open", codec: "json", initial: [], url: "replace", share: true, agent: "set" },
  },
  subject: { field: "sha", noun: "capture", roster: "captures", detail: "captures", pane: "captures" },
  readings: { captures: { kind: "use", entry: "captures.list", deps: { page: [], work: [], readings: [] },
    demand: "visible", retain: { evidence: "scope", resource: "scope" }, refresh: "explicit" } },
  verbs: {}, panes: { captures: { label: "Captures", purpose: "Inspect retained pictures", draws: ["captures"], verbs: [], body: "main" } },
  layout: { kind: "pane", id: "captures" }, stages: { main: { word: "Captures", panes: ["captures"], verbs: [] } },
  stageOrder: ["main"], predicates: {}, cells: {}, workFields: {}, seeds: {}, needs: "nothing", resetOnTarget: [], observe: [],
} as const satisfies RouteGraphJson;
const local = z.custom<IdentityId<"local">>((v) => typeof v === "string" && identityCodecs.local.decode(v).ok);
export const schemas = { subject: local.nullable(), open: z.array(z.string()) };
export const entries = { "captures.list": { input: z.object({}), output: z.array(captureReceiptSchema),
  axes: { subject: "None", touches: ["Metadata"], effect: "Read", cost: "Cheap", cardinality: "One" } } } as const;
export const captureId = (sha: string) => {
  const id = identityCodecs.local.encode({ namespace: "captures", subject: sha });
  if (!id.ok) throw Error(id.reason);
  return id.value;
};
const source = { module: "route.js", export: "module" };
export const bodies = {
  pick: { slot: "fields.sha.picker.options", kind: "picker", source,
    run: (reading) => reading.current ? reading.value.map((c) => ({ id: captureId(c.sha), label: c.view.name ?? "view" })) : [] },
  main: { slot: "panes.captures.body", kind: "pane", source,
    run: (ctx) => ({ reading: ctx.readings.captures, page: ctx.page.read() }) },
} satisfies BodyBindings<typeof capturesData, typeof schemas, typeof entries>;
export const module = { data: capturesData, schemas, entries, bodies,
  identities: { local: identityCodecs.local },
  codecs: {
    subject: { encode: (value: z.output<typeof schemas.subject>) => JSON.stringify(value), decode: (text: string) => {
      try { const value = schemas.subject.parse(JSON.parse(text)); return { ok: true as const, value }; }
      catch { return { ok: false as const, reason: "Invalid capture subject" }; }
    } },
    json: { encode: (value: string[]) => JSON.stringify(value), decode: (text: string) => {
      try { return { ok: true as const, value: schemas.open.parse(JSON.parse(text)) }; }
      catch { return { ok: false as const, reason: "Invalid open captures" }; }
    } },
  },
};
