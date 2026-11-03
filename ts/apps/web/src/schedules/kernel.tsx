import { useState, type ReactNode } from "react";
import { z } from "zod";
import {
  scheduleCatalogSchema,
  scheduleReadingSchema,
  scheduleReads,
  scheduleGridRouteState,
} from "@pe/agent-contracts";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import type { RouteModule } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import type { IdentityId } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { identityCodecs } from "../shell/page-port";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { ScheduleGridWorkspace, type ScheduleGridState } from "../route/schedules/workspace";
import { schedulesSeeds } from "./graph-seeds";
import { schedulesKernelSources } from "./kernel-sources";

const deps = { page: [], work: [], readings: [] } as const;
const policy = {
  demand: "visible",
  retain: { evidence: "scope", resource: "scope" },
  refresh: "dependencies",
} as const;
const source = { module: "kernel.tsx", export: "module" };
export const scheduleIdentity = (workspace: string) => {
  const result = identityCodecs.local.encode({ namespace: "schedules", subject: workspace });
  if (!result.ok) throw Error(result.reason);
  return result.value;
};
export const schedulesData = {
  version: 1,
  key: "schedules",
  address: "/schedules",
  name: "Schedules",
  capabilities: ["work"],
  needs: "project",
  directory: {
    group: "Coordinate model data",
    summary: "Inspect document schedules",
    label: "Revit data",
    icon: "LayoutGrid",
    exposure: "Preview",
    surfaces: { web: "full", pwa: "full", tray: false },
    aliases: ["Revit", "data"],
    runtimeNeed: "Open project document",
    listed: true,
    satellites: [{ to: "/schedule-specs", label: "Schedule definitions" }],
    resume: "document",
  },
  identities: { schedule: { kind: "local", codec: "local" } },
  fields: {
    workspaceId: {
      role: "subject",
      schema: "subject",
      codec: "subject",
      initial: null,
      cardinality: "one",
      identity: "schedule",
      picker: { reading: "catalog", options: "pick" },
      url: "push",
      share: true,
      agent: "set",
    },
    selected: { role: "selection", kinds: ["schedule"] },
    table: {
      role: "pose",
      schema: "table",
      codec: "json",
      initial: { query: "", sorts: [], hiddenColumns: [] },
      url: "replace",
      share: true,
      agent: "set",
    },
  },
  subject: {
    field: "workspaceId",
    noun: "schedule",
    roster: "catalog",
    detail: "retained",
    pane: "grid",
  },
  work: { schema: "work", route: "schedules", version: 1, migrations: {} },
  // TODO: W3 REPORT.md G2. The generic mount binds encoded subject bytes, not the host workspace ID.
  workSubject: "workspaceId",
  readings: {
    catalog: { kind: "use", entry: "schedules.catalog", args: "empty", deps, ...policy },
    retained: {
      kind: "use",
      entry: "schedules.retained",
      args: "workspace",
      deps: { ...deps, page: ["workspaceId"] },
      ...policy,
    },
    snapshot: {
      kind: "use",
      entry: "schedule.grid.snapshot",
      deps,
      ...policy,
      demand: "explicit",
      refresh: "explicit",
    },
  },
  verbs: {
    read: {
      kind: "query",
      input: "read",
      label: "Read schedule",
      review: "none",
      deps,
      captures: [],
      entry: "schedule.grid.snapshot",
      args: "readArgs",
      cancellation: "scope",
      lands: "readLands",
    },
    edit: {
      kind: "work",
      input: "edit",
      label: "Edit schedule cells",
      review: "none",
      deps,
      captures: [],
      patches: "edit",
    },
  },
  panes: {
    grid: {
      label: "Schedules",
      purpose: "Inspect and edit schedule cells",
      draws: ["catalog", "retained", "snapshot"],
      verbs: ["read", "edit"],
      body: "grid",
    },
  },
  layout: { kind: "pane", id: "grid" },
  stages: { main: { word: "Schedules", panes: ["grid"], verbs: ["read", "edit"] } },
  stageOrder: ["main"],
  predicates: {},
  cells: {},
  workFields: {},
  seeds: { read: { title: "Mechanical equipment", load: "seed" } },
  resetOnTarget: [],
  observe: [],
} as const satisfies RouteGraphJson;
const schemas = {
  subject: z
    .custom<IdentityId<"local">>((v) => typeof v === "string" && identityCodecs.local.decode(v).ok)
    .nullable(),
  table: z.object({
    query: z.string(),
    sorts: z.array(z.object({ key: z.string(), dir: z.enum(["asc", "desc"]) })),
    hiddenColumns: z.array(z.string()),
  }),
  work: scheduleGridRouteState.schema,
  read: scheduleReads["schedule.grid.snapshot"].input,
  edit: z.object({ cells: scheduleGridRouteState.schema.shape.cells }),
};
const axes = {
  subject: "None",
  touches: ["Metadata"],
  effect: "Read",
  cost: "Cheap",
  cardinality: "One",
} as const;
const entries = {
  "schedules.catalog": { input: z.object({}), output: scheduleCatalogSchema.nullable(), axes },
  "schedules.retained": {
    input: z.string().nullable(),
    output: scheduleReadingSchema.nullable(),
    axes,
  },
  "schedule.grid.snapshot": {
    input: schemas.read,
    output: scheduleReadingSchema,
    axes: { ...axes, subject: "Elements", cost: "Mutation" },
  },
} as const;
export const bodies = {
  empty: { slot: "readings.catalog.args", kind: "args", source, run: () => ({}) },
  workspace: {
    slot: "readings.retained.args",
    kind: "args",
    source,
    run: (ctx) =>
      ctx.page.workspaceId ? identityCodecs.local.parts(ctx.page.workspaceId).subject : null,
  },
  pick: {
    slot: "fields.workspaceId.picker.options",
    kind: "picker",
    source,
    run: (r) =>
      (r.value?.schedules ?? [])
        .filter((s) => s.workspaceId)
        .map((s) => ({ id: scheduleIdentity(s.workspaceId!), label: s.name })),
  },
  readArgs: { slot: "verbs.read.args", kind: "args", source, run: (_, input) => input },
  readLands: {
    slot: "verbs.read.lands",
    kind: "lands",
    source,
    run: (reading) => ({ workspaceId: scheduleIdentity(reading.workspaceId) }),
  },
  edit: {
    slot: "verbs.edit.patches",
    kind: "work",
    source,
    run: (_, input) => [{ path: ["cells"], value: input.cells }],
  },
  seed: {
    slot: "seeds.read.load",
    kind: "seed",
    source,
    run: () => ({
      page: { workspaceId: scheduleIdentity("schedule:fixture") },
      work: schedulesSeeds.read.work,
      readings: {
        catalog: scheduleCatalogSchema.parse({
          schedules: schedulesSeeds.read.readings.catalog.schedules.map((row) => ({
            ...row,
            rowCount: 1,
            isPlacedOnSheet: false,
          })),
        }),
        retained: schedulesSeeds.read.readings.retained,
        snapshot: schedulesSeeds.read.readings.retained,
      },
    }),
  },
  grid: {
    slot: "panes.grid.body",
    kind: "pane",
    source,
    run: (ctx) => {
      const p = ctx.page.read();
      const fresh = ctx.readings.snapshot.current ? ctx.readings.snapshot : ctx.readings.retained;
      const shown = fresh.value;
      const rawWork: unknown = ctx.work;
      const work = rawWork ? scheduleGridRouteState.schema.parse(rawWork) : null;
      const state: ScheduleGridState = {
        slice: work,
        revision: ctx.workBasis?.workRevision ?? null,
        hydrated: !!ctx.work,
        // TODO: W3 REPORT.md G1. Pane verbs erase the Work outcome needed by grid cell writes.
        apply: async () => ({
          code: "not-ready",
          message: "Admitted grid writes await the shared Work outcome door",
        }),
        execute: async () => ({
          code: "not-ready",
          message: "Use Read schedule beside the schedule name",
        }),
        snapshot: shown ? scheduleReadingSchema.parse(shown).snapshot : null,
        catalog: ctx.readings.catalog.value
          ? scheduleCatalogSchema.parse(ctx.readings.catalog.value)
          : null,
        busy: null,
        refused: {},
        onFocus: { grid: () => {} },
        freshness: fresh.current ? "current" : "changed",
        table: schemas.table.parse(p.table),
        setTable: (table) =>
          ctx.page.pose(
            {
              table: {
                query: table.query,
                sorts: table.sorts,
                hiddenColumns: table.hiddenColumns ?? [],
              },
            },
            "named",
          ),
        cell: "",
        locate: () => {},
      };
      return (
        <>
          <a href="/schedule-specs">Schedule definitions</a>
          {(ctx.readings.catalog.value?.schedules ?? []).map((row) => (
            <Button
              key={row.scheduleId}
              label={`Read ${row.name}`}
              onClick={() => ctx.verbs.read({ scheduleId: row.scheduleId, maxRows: 200 })}
            >
              {row.name}
            </Button>
          ))}
          {!fresh.current && (
            <OutcomeLine
              kind="error"
              label="Schedule reading"
              says={fresh.reason ?? "Reading is unavailable"}
            />
          )}
          <Grid state={state} />
        </>
      );
    },
  },
} satisfies BodyBindings<typeof schedulesData, typeof schemas, typeof entries, ReactNode>;
// Candidate only: retain the legacy route until the required gaps in W3 REPORT.md close.
export const module = {
  data: schedulesData,
  schemas,
  entries,
  bodies,
  sources: schedulesKernelSources(),
  identities: { local: identityCodecs.local },
  codecs: {
    subject: {
      encode: (value: z.output<typeof schemas.subject>) => value ?? "",
      decode: (text: string) => ({
        ok: true as const,
        value: text
          ? scheduleIdentity(
              identityCodecs.local.decode(text).ok
                ? identityCodecs.local.parts(schemas.subject.parse(text)!).subject
                : text,
            )
          : null,
      }),
    },
    json: {
      encode: JSON.stringify,
      decode: (text: string) => {
        try {
          return { ok: true as const, value: JSON.parse(text) };
        } catch {
          return { ok: false as const, reason: "Invalid JSON" };
        }
      },
    },
  },
} satisfies Omit<
  RouteModule<typeof schedulesData, typeof schemas, typeof entries, ReactNode>,
  "artifact"
>;

function Grid({ state }: { state: ScheduleGridState }) {
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <>
      {failure && <OutcomeLine kind="error" label="Schedule grid" says={failure} />}
      <ScheduleGridWorkspace state={state} onRefused={setFailure} onHidden={setFailure} />
    </>
  );
}
