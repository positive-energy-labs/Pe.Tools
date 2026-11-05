import type { HostRouteModule } from "../../../../packages/agent-contracts/src/host-route-admission.ts";
import { z } from "zod";
import {
  scheduleCatalogSchema,
  scheduleReadingSchema,
  scheduleReads,
  scheduleGridRouteState,
  scheduleGridCellSchema,
  showCellValue,
  splitScheduleCellKey,
  commands,
  actionReceiptListDecoder,
  workKeySchema,
} from "@pe/agent-contracts";
import type { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import type { IdentityId } from "../../../../packages/agent-contracts/src/route-kernel-page.ts";
import { commandCatalogAxes } from "../../../../packages/agent-contracts/src/command-axes.ts";
export const scheduleFixtureReading = scheduleReadingSchema.parse({
  id: "a".repeat(64),
  workspaceId: "schedule:fixture",
  target: { session: "fixture", openId: "schedules" },
  document: "C:/Fixtures/Schedules.rvt",
  capturedAt: "2026-10-30T00:00:00Z",
  process: { pid: 1, processStartUtc: "2026-10-30T00:00:00Z", executable: "Fixture" },
  snapshot: {
    scheduleId: 42,
    scheduleUniqueId: "schedule-42",
    scheduleName: "Mechanical equipment",
    columns: [
      { columnNumber: 0, headerText: "Tag", fieldName: "Tag" },
      { columnNumber: 1, headerText: "Model", fieldName: "Model" },
    ],
    rows: [{ rowNumber: 1, values: ["IU-1", "FXMQ15"], subjectIds: [101], bindings: [] }],
  },
});
const reading = scheduleFixtureReading;
const seed = {
  title: "Mechanical equipment",
  page: { workspaceId: "schedule:fixture" },
  work: scheduleGridRouteState.schema.parse({ basis: { captureId: reading.id } }),
  readings: {
    catalog: {
      schedules: [
        {
          scheduleId: 42,
          workspaceId: "schedule:fixture",
          name: "Mechanical equipment",
          categoryName: "Equipment",
        },
      ],
    },
    retained: reading,
    saved: null,
    history: [],
    receipts: [],
    outcome: null,
    pods: [],
  },
  queries: {
    "schedule.grid.snapshot": reading,
    "schedule.grid.bind": {
      envelope: {
        version: 1,
        revision: 0,
        doc: scheduleGridRouteState.schema.parse({ basis: { captureId: reading.id } }),
      },
    },
  },
};
const schedulesSeeds = { read: seed, apply: seed };

export interface ScheduleOutcome {
  unread: number;
  refused: Readonly<Record<string, string>>;
  readbackError: string | null;
  receiptId: string | null;
}

/** Push failures are host results. Derive them from the receipt; never copy them into Page/Work. */
export function scheduleOutcome(
  rows: readonly {
    key: string;
    id: string;
    startedAt: string;
    result?: unknown;
    refusal?: unknown;
  }[],
): ScheduleOutcome {
  const receipt = rows
    .filter((r) => r.key === "schedule.grid.push")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!receipt) return { unread: 0, refused: {}, readbackError: null, receiptId: null };
  const wrapped = z
    .object({ value: z.unknown() })
    .refine((v) => Object.hasOwn(v, "value"))
    .safeParse(receipt.result);
  const result = z
    .object({
      failures: z.array(z.object({ key: z.string(), error: z.string() })).default([]),
      readbackError: z.string().optional(),
    })
    .safeParse(wrapped.success ? wrapped.data.value : receipt.result);
  const stale = z
    .object({
      kind: z.literal("stale"),
      consumed: z.array(
        z.object({
          kind: z.string(),
          probe: z
            .object({ paths: z.array(z.array(z.union([z.string(), z.number()]))) })
            .optional(),
        }),
      ),
    })
    .safeParse(receipt.refusal);
  const failures = result.success ? result.data.failures : [];
  return {
    unread: result.success && result.data.readbackError ? failures.length : 0,
    refused: Object.fromEntries([
      ...failures.map((f) => [f.key, f.error]),
      ...(stale.success
        ? stale.data.consumed.flatMap((e) =>
            e.kind === "work"
              ? (e.probe?.paths ?? [])
                  .filter((p) => p[0] === "cells" && typeof p[1] === "string")
                  .map((p) => [p[1], "changed since review"])
              : [],
          )
        : []),
    ]),
    readbackError: result.success ? (result.data.readbackError ?? null) : null,
    receiptId: receipt.id,
  };
}

const deps = { page: [], work: [], readings: [] } as const;
const policy = {
  demand: "visible",
  retain: { evidence: "scope", resource: "scope" },
  refresh: "dependencies",
} as const;
export const source = { module: "schedules/neutral.ts", export: "neutralBodies" };
const localId = z.custom<IdentityId<"local">>((v) => {
  if (typeof v !== "string") return false;
  try {
    const p = z.tuple([z.literal("schedules"), z.string().min(1)]).parse(JSON.parse(v));
    return JSON.stringify(p) === v;
  } catch {
    return false;
  }
});
export const scheduleIdentity = (workspace: string) =>
  localId.parse(JSON.stringify(["schedules", workspace]));
export const schedulesData = {
  version: 1,
  key: "schedules",
  address: "/schedules",
  name: "Schedules",
  capabilities: ["work", "native-write"],
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
    satellites: [],
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
    saved: {
      kind: "use",
      entry: "schedules.saved",
      args: "savedArgs",
      deps: { ...deps, work: ["basis"] },
      ...policy,
    },
    receipts: {
      kind: "use",
      entry: "schedules.receipts",
      args: "receiptArgs",
      deps: { ...deps, page: ["workspaceId"] },
      ...policy,
    },
    outcome: {
      kind: "derive",
      output: "outcome",
      derive: "outcome",
      deps: { ...deps, readings: ["receipts"] },
      ...policy,
    },
    preview: {
      kind: "use",
      entry: "schedule.grid.push.preview",
      deps,
      ...policy,
      demand: "explicit",
      refresh: "explicit",
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
    bind: {
      kind: "command",
      entry: "schedule.grid.bind",
      intent: "bind",
      input: "none",
      label: "Bind schedule",
      review: "none",
      deps: { ...deps, readings: ["retained"] },
      captures: [],
    },
    push: {
      kind: "command",
      entry: "schedule.grid.push",
      intent: "push",
      input: "none",
      label: "Apply cells",
      review: "shown",
      ready: "pushReady",
      present: "presentPush",
      deps: { ...deps, work: ["basis", "cells"], readings: ["saved", "receipts"] },
      captures: [],
    },
    edit: {
      kind: "work",
      input: "edit",
      label: "Edit schedule cells",
      review: "none",
      deps: {
        ...deps,
        page: ["workspaceId"],
        work: ["cells", "basis", "takenAt"],
        readings: ["retained"],
      },
      captures: [],
      patches: "edit",
      describe: "describeEdit",
      ready: "editReady",
    },
  },
  panes: {
    grid: {
      label: "Schedules",
      purpose: "Inspect and edit schedule cells",
      draws: ["catalog", "retained", "snapshot", "saved", "receipts", "outcome"],
      verbs: ["read", "edit", "bind", "push"],
      body: "grid",
    },
  },
  layout: { kind: "pane", id: "grid" },
  stages: { main: { word: "Schedules", panes: ["grid"], verbs: ["read", "edit", "bind", "push"] } },
  stageOrder: ["main"],
  predicates: {},
  cells: {},
  workFields: {},
  seeds: { read: { title: "Mechanical equipment", load: "seed" } },
  resetOnTarget: [],
  observe: [],
} as const satisfies RouteGraphJson;
export const schemas = {
  none: z.strictObject({}),
  outcome: z.object({
    unread: z.number(),
    refused: z.record(z.string(), z.string()),
    readbackError: z.string().nullable(),
    receiptId: z.string().nullable(),
  }),
  subject: localId.nullable(),
  table: z.object({
    query: z.string(),
    sorts: z.array(z.object({ key: z.string(), dir: z.enum(["asc", "desc"]) })),
    hiddenColumns: z.array(z.string()),
  }),
  work: scheduleGridRouteState.schema,
  read: scheduleReads["schedule.grid.snapshot"].input,
  edit: z.object({
    patches: z.array(
      z.union([
        z.object({
          path: z.tuple([z.literal("cells"), z.string()]),
          value: scheduleGridCellSchema,
        }),
        z
          .strictObject({
            path: z.tuple([z.literal("cells"), z.string()]),
            op: z.literal("delete").optional(),
          })
          .transform((p) => ({ path: p.path, op: "delete" as const })),
        z
          .object({
            path: z.tuple([z.literal("cells"), z.string(), z.literal("edit")]),
            value: scheduleGridCellSchema.shape.edit,
          })
          .transform((p) => ({ path: p.path, value: p.value })),
      ]),
    ),
  }),
};
const axes = {
  subject: "None",
  touches: ["Metadata"],
  effect: "Read",
  cost: "Cheap",
  cardinality: "One",
} as const;
export const entries = {
  "schedules.saved": {
    input: z.string().nullable(),
    output: scheduleReadingSchema.nullable(),
    axes,
  },
  "schedules.receipts": {
    input: workKeySchema.nullable(),
    output: actionReceiptListDecoder(),
    axes,
  },
  "schedule.grid.bind": {
    input: commands["schedule.grid.bind"].input,
    output: z.unknown(),
    axes: commandCatalogAxes["schedule.grid.bind"],
  },
  "schedule.grid.push": {
    input: commands["schedule.grid.push"].input,
    output: commands["schedule.grid.push"].result,
    axes: { ...commandCatalogAxes["schedule.grid.push"], effect: "ModelWrite" as const },
  },
  "schedule.grid.push.preview": {
    input: commands["schedule.grid.push.preview"].input,
    output: commands["schedule.grid.push.preview"].result,
    axes: commandCatalogAxes["schedule.grid.push.preview"],
  },
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
export const neutralBodies: Omit<
  BodyBindings<typeof schedulesData, typeof schemas, typeof entries>,
  "grid"
> = {
  savedArgs: {
    slot: "readings.saved.args",
    kind: "args",
    source,
    run: (ctx) => ctx.work.basis?.captureId ?? null,
  },
  receiptArgs: {
    slot: "readings.receipts.args",
    kind: "args",
    source,
    run: (ctx) =>
      ctx.page.workspaceId
        ? {
            binding: "workspace",
            route: "schedules",
            target: null,
            work: JSON.parse(ctx.page.workspaceId)[1],
          }
        : null,
  },
  outcome: {
    slot: "readings.outcome.derive",
    kind: "derive",
    source,
    run: (ctx) => scheduleOutcome(ctx.readings.receipts.value ?? []),
  },
  bind: {
    slot: "verbs.bind.intent",
    kind: "intent",
    source,
    run: (ctx) => {
      const reading = ctx.readings.retained.value;
      if (!reading || ctx.workBasis?.workRevision == null)
        throw Error("Read this schedule before binding");
      return { readingId: reading.id, expectedRevision: ctx.workBasis.workRevision };
    },
  },
  push: { slot: "verbs.push.intent", kind: "intent", source, run: () => ({}) },
  pushReady: {
    slot: "verbs.push.ready",
    kind: "ready",
    source,
    run: (ctx) => {
      if (ctx.readings.saved.value?.id !== ctx.work.basis?.captureId)
        return "Wait for the bound schedule evidence";
      if (ctx.work.basis?.stale?.length) return "Review changed schedule cells before pushing";
      if (!Object.values(ctx.work.cells).some((cell) => cell.edit)) return "Edit a cell first";
      if (
        (ctx.readings.receipts.value ?? []).some((r) =>
          ["running", "unknown", "incomplete", "waiting"].includes(r.state),
        )
      )
        return "Recover the outstanding receipt before a new push";
      return true;
    },
  },
  presentPush: {
    slot: "verbs.push.present",
    kind: "present",
    source,
    run: (_result, evidence) => {
      const reading = evidence.readings.saved.value;
      const edits = Object.entries(evidence.work.cells).filter(([, cell]) => cell.edit);
      return {
        sentence: `Apply ${edits.length} edited schedule cells`,
        rows: edits.map(([key, cell]) => {
          const { rowNumber, columnNumber } = splitScheduleCellKey(key);
          const row = reading?.snapshot.rows.find((r) => r.rowNumber === rowNumber);
          const column = reading?.snapshot.columns.find((c) => c.columnNumber === columnNumber);
          const index =
            reading?.snapshot.columns.findIndex((c) => c.columnNumber === columnNumber) ?? -1;
          return `${row?.values[0] ?? `Row ${rowNumber}`} \u00b7 ${column?.headerText ?? `Column ${columnNumber}`}: ${showCellValue(row?.values[index])} \u2192 ${showCellValue(cell.edit?.value)}`;
        }),
      };
    },
  },
  empty: { slot: "readings.catalog.args", kind: "args", source, run: () => ({}) },
  workspace: {
    slot: "readings.retained.args",
    kind: "args",
    source,
    run: (ctx) => (ctx.page.workspaceId ? JSON.parse(ctx.page.workspaceId)[1] : null),
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
  editReady: {
    slot: "verbs.edit.ready",
    kind: "ready",
    source,
    run: (ctx) => {
      const reading = ctx.readings.retained.value;
      const target = ctx.workBasis?.token.scope.identity.target;
      return reading &&
        ctx.work.basis &&
        ctx.page.workspaceId === scheduleIdentity(reading.workspaceId) &&
        target?.kind === "document" &&
        target.ref.session === reading.target.session &&
        target.ref.openId === reading.target.openId
        ? true
        : "Read and bind the schedule in this exact document lifetime before editing";
    },
  },
  edit: {
    slot: "verbs.edit.patches",
    kind: "work",
    source,
    run: (_, input) => input.patches,
  },
  describeEdit: {
    slot: "verbs.edit.describe",
    kind: "describe",
    source,
    run: (input) => ({
      label: input.patches
        .map(
          (patch) =>
            `Cell ${patch.path[1]} \u2192 ${"value" in patch ? showCellValue(patch.value) : "unstage"}`,
        )
        .join(", "),
    }),
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
        saved: schedulesSeeds.read.readings.retained,
        receipts: [],
      },
    }),
  },
};
export const schedulesHostModule: HostRouteModule = {
  data: schedulesData,
  schemas,
  bodies: {},
  workState: scheduleGridRouteState,
};
