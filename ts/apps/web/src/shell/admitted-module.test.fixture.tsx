// Test-only admitted-kernel witness. Production Captures mounts its typed module.
import { createElement, Fragment, type ReactNode } from "react";
import { CapturesList } from "../captures/list";
import type { RouteModule } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import { z } from "zod";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { IdentityId } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { captureReceiptSchema } from "../../../../packages/agent-contracts/src/capture";
import { identityCodecs } from "../../../../packages/agent-contracts/src/route-kernel-codecs.ts";

export const capturesData = {
  version: 1,
  capabilities: [],
  key: "captures",
  address: "/captures",
  name: "Captures",
  directory: {
    group: "Coordinate model data",
    summary: "Inspect retained view pictures and receipts",
    label: "Revit data",
    exposure: "Preview",
    runtimeNeed: "Host retained view images",
    icon: "Image",
    aliases: ["Revit", "data"],
    listed: true,
    satellites: [],
    surfaces: { web: "full", pwa: "full", tray: false },
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
      args: "captureArgs",
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
  // orderedListField has no all mode; retain the existing open-all URL behavior.
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
  captureArgs: {
    slot: "readings.captures.args",
    kind: "args",
    source,
    run: () => ({}),
  },
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
    run: (ctx) => {
      const page = ctx.page.read();
      const reading = ctx.readings.captures;
      const captures = reading.value ?? [];
      return createElement(
        Fragment,
        null,
        !reading.current && createElement("p", null, reading.reason),
        createElement(CapturesList, {
          captures,
          focus:
            (page.selected[0]?.id ?? page.sha)
              ? identityCodecs.local.parts((page.selected[0]?.id ?? page.sha)!).subject
              : undefined,
          open: page.open.kind === "all" ? captures.map((c) => c.sha) : page.open.ids,
          onPage: (next) => {
            // Selection owns the picked row; subject changes remain kernel-controlled.
            if (next.sha !== undefined)
              ctx.page.select([{ kind: "capture", id: captureId(next.sha) }]);
            if (next.open) ctx.page.pose({ open: { kind: "ids", ids: next.open } }, "named");
          },
        }),
      );
    },
  },
} satisfies BodyBindings<typeof capturesData, typeof schemas, typeof entries, ReactNode>;
export const module = {
  sources: {"captures.list": {kind:"use" as const, open:(()=>()=>{}) as import("./readings").UseSource["open"]}},
  data: capturesData,
  schemas,
  entries,
  bodies,
  identities: { local: identityCodecs.local },
  codecs: {
    subject: {
      encode: (value: z.output<typeof schemas.subject>) => value ?? "",
      decode: (text: string) => {
        if (text === "") return { ok: true as const, value: null };
        const decoded = identityCodecs.local.decode(text);
        return { ok: true as const, value: decoded.ok ? decoded.value : captureId(text) };
      },
    },
    json: {
      encode: (value: z.output<typeof schemas.open>) => JSON.stringify(value),
      decode: (text: string) => {
        try {
          return { ok: true as const, value: schemas.open.parse(JSON.parse(text)) };
        } catch {
          return {
            ok: true as const,
            value:
              text === "all"
                ? { kind: "all" as const }
                : { kind: "ids" as const, ids: text ? text.split(",") : [] },
          };
        }
      },
    },
  },
} satisfies Omit<
  RouteModule<typeof capturesData, typeof schemas, typeof entries, ReactNode>,
  "artifact"
>;
