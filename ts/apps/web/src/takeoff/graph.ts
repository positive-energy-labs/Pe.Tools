import { defineRouteGraph } from "@pe/agent-contracts";
// TODO: docs/features/routes/LEDGER.md#s6-declaration-takeoff Declaration 112 > 60 after kernel defaults. Adopt/sync/retry/launch workflows and atlas selection remain distinct.
import { manyField } from "../../../../packages/agent-contracts/src/route-field";
import { z } from "zod";
import {
  gate,
  pane,
  split,
  takeoffDecisionAddress,
  takeoffEditAddress,
  takeoffsRouteState,
  type RouteGraph,
  type TakeoffsRouteDocument,
  type TakeoffObservation,
} from "@pe/agent-contracts";
import { field, text, type ScalarSchema } from "../../../../packages/agent-contracts/src/route-field";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
import { takeoffsAddress } from "../../../../packages/agent-contracts/src/routes/takeoffs";
import { takeoffPageSchema } from "./actions";
import { withEditBases } from "./projections";
import { takeoffVerbs } from "./graph-actions";

export const takeoffGraphPageSchema = takeoffPageSchema
  .omit({ panel: true, syncReview: true })
  .extend({
    work: z.string().default(""),
    fileText: z.boolean().default(false),
    views: manyField("name", {}).schema,
    zones: manyField("UniqueId", {}).schema,
  });
export type TakeoffGraphPage = z.output<typeof takeoffGraphPageSchema>;
const json = <S extends z.ZodType>(schema: ScalarSchema<S>) =>
  field(schema, {}, { encode: JSON.stringify, decode: JSON.parse });
const a = takeoffsAddress.fields;
const rowPartitions = Object.assign(
  (row: unknown) => ((row as { zone?: string })?.zone ? ["partition"] : []),
  { ids: ["partition"] },
);
export const takeoffBase: RouteGraph<TakeoffGraphPage, TakeoffsRouteDocument> = defineRouteGraph({
  directory: {
    path: "/takeoffs",
    title: "Takeoffs",
    label: "Manual J",
    exposure: "Main",
    runtimeNeed: "Revit for model actions; browsing saved data is separate",
    icon: "Map",
    category: "Calculate loads & airflow",
    blurb:
      "The takeoff atlas â€” zones on the plan, rooms in the table, Manual J data through to a synced RHVAC .r10.",
    aliases: ["manual", "j", "loads", "rhvac", "zones"],
    listed: true,
    satellites: [],
    surfaces: {
      web: "full",
      pwa: "full",
      tray: false,
    },
    resume: "document",
  },
  key: "takeoffs",
  address: "takeoffs",
  name: "Takeoffs",
  seeds: {
    adopt: {
      title: "project-a â€” regions drawn, nothing adopted",
      load: () => import("./graph-seeds").then((m) => m.takeoffSeeds["adopt"]!),
    },
    partition: {
      title: "project-a â€” zones adopted, ready to partition",
      load: () => import("./graph-seeds").then((m) => m.takeoffSeeds["partition"]!),
    },
    refresh: {
      title: "project-a â€” a stale model waiting for a re-read",
      load: () => import("./graph-seeds").then((m) => m.takeoffSeeds["refresh"]!),
    },
    sync: {
      title: "project-a â€” partitioned, .r10 bound, sync unreviewed",
      load: () => import("./graph-seeds").then((m) => m.takeoffSeeds["sync"]!),
    },
    launch: {
      title: "project-a â€” synced, RHVAC not open",
      load: () => import("./graph-seeds").then((m) => m.takeoffSeeds["launch"]!),
    },
    "retry-r10": {
      title: "project-a â€” the .r10 read failed",
      load: () => import("./graph-seeds").then((m) => m.takeoffSeeds["retry-r10"]!),
    },
  },
  needs: "project",
  work: takeoffsRouteState.schema,
  workRoute: "takeoffs",
  capture: "work",
  workSubject: "work",
  resetOnTarget: ["views", "zones", "r10", "stage", "level", "zone", "room", "viewport"],
  subjectField: {
    field: "views",
    noun: "view",
    keyKind: "name",
    cardinality: "many",
    roster: "roster",
    detail: "candidates",
    pane: "scope",
  },
  fields: {
    threadSearch: { ...threadListFields.threadSearch, role: "query" },
    threadSort: { ...threadListFields.threadSort, role: "query" },
    level: { ...a.level, agent: "read" },
    zone: { ...a.zone, agent: "read" },
    room: { ...a.room, role: "selection", agent: "read" },
    viewport: a.viewport,
    work: { ...field(text(), {}), role: "transient" },
    views: {
      ...manyField("name", {}),
      picker: {
        reading: "roster",
        placeholder: "Choose views",
        options: (value) => (value as { views?: { id: string; label: string }[] })?.views ?? [],
      },
      cardinality: "many",
      url: "push",
      share: true,
    },
    zones: { ...manyField("UniqueId", {}), role: "query", url: "push", share: true },
    r10: { ...field(text(), {}), role: "draft", url: "push", share: true },
    stage: { ...field(takeoffGraphPageSchema.shape.stage, {}), url: false },
    fileText: { ...json(takeoffGraphPageSchema.shape.fileText), role: "transient" },
  },
  transition: (current, patch) => ({
    patch: {
      ...patch,
      ...(patch.level !== undefined && patch.level !== current.level ? { viewport: null } : {}),
    },
  }),
  workFields: {
    bases: { label: "read bases", internal: true },
  },
  cells: [
    {
      segment: "edits",
      groupOf: (key) => [takeoffEditAddress(key).roomId],
      nouns: ["room"],
      noun: "room edits",
      take: (doc, key, readings) => {
        const observation = readings.snapshot?.value as TakeoffObservation | undefined;
        if (!readings.snapshot?.current || observation?.kind !== "ready")
          throw Error("Read the current document before accepting a room proposal");
        const patches = withEditBases(doc, observation.capture.snapshot.world, [
          { path: ["edits", key, "edit"], value: {} },
        ]);
        return patches.filter((patch) => patch.path[0] === "bases");
      },
    },
    { segment: "adopt", groupOf: (key) => [key.slice(0, key.lastIndexOf(":"))], noun: "adoption" },
    {
      segment: "decisions",
      groupOf: (key) => [takeoffDecisionAddress(key).roomGuid],
      noun: "flag verdicts",
    },
    { segment: "reviewFlags", groupOf: (key) => [JSON.parse(key)[0]], noun: "review flags" },
  ],
  readings: {
    // TODO: docs/features/routes/LEDGER.md#s7-e8f071edc9 native metadata zone roster is missing; saved captures supply zone choices.
    roster: {    deps: ["saved"] },
    snapshot: {
      deps: ["roster"],
      args: (p) => [p.work, p.views, p.zones],
    },
    candidates: {
      deps: ["roster"],
      args: (p) => [p.work, p.views],
    },
    ownerCrops: {
      deps: ["snapshot", "saved", "roster"],
      args: (p) => [p.work, p.level, p.views],
    },
    plan: {
      deps: ["snapshot", "saved", "ownerCrops", "roster"],
      args: (p) => [p.work, p.level, p.views],
    },
    rhvacVersion: {
      args: (p) => [p.work, p.r10],
    },
    receipts: {},
    captures: {   retire: "never" },
    saved: {    args: (p) => p.work },
    text: {
      args: (p) => [p.work, p.fileText],
    },
  },
  verbs: takeoffVerbs,
  panes: {
    scope: {
      label: "Takeoff scope",
      purpose: "Choose views, zones and an RHVAC file",
      draws: ["snapshot", "saved", "captures", "rhvacVersion"],
    },
    adoption: {
      label: "Adopt zoning regions",
      purpose: "Stage designer region names and system tags",
      draws: ["candidates"],
    },
    navigation: {
      label: "Zones",
      purpose: "Navigate levels and zones",
      draws: ["snapshot", "saved"],
      verbs: rowPartitions,
    },
    plan: {
      label: "Plan",
      purpose: "Inspect model geometry against its registered owner view",
      draws: ["plan"],
    },
    rooms: {
      label: "Rooms",
      purpose: "Edit Manual J room data and decide calls",
      draws: ["snapshot", "saved"],
    },
    room: { label: "Room details", purpose: "Inspect the selected room", },
    review: {
      label: "Review",
      purpose: "Review native partition evidence and authored proposals",
      draws: ["receipts", "text"],
    },
  },
  layout: split(
    "takeoff-body",
    { axis: "v", sized: "start", size: 72 },
    pane("scope"),
    split(
      "takeoff-adoption",
      { axis: "v", sized: "start", size: 220 },
      gate("adopt", pane("adoption")),
      split(
        "takeoff-atlas",
        { axis: "h", sized: "start", size: 288, minSize: 200 },
        pane("navigation"),
        split(
          "takeoff-main",
          {
            axis: "v",
            sized: "start",
            size: 354,
            minSize: 174,
            maxSize: 754,
            minOtherSize: 220,
            persist: "pe.takeoffs.plan-height",
          },
          pane("plan"),
          split(
            "takeoff-lower",
            { axis: "v", sized: "end", size: 180 },
            split(
              "takeoff-table",
              {
                axis: "h",
                sized: "end",
                size: 288,
                minSize: 240,
                maxSize: 520,
                minOtherSize: 360,
                persist: "pe.takeoffs.room-panel-width",
              },
              pane("rooms"),
              pane("room"),
            ),
            pane("review"),
          ),
        ),
      ),
    ),
  ),
  stages: {
    adopt: {
      word: "Adopting zones",
      verbs: ["refresh", "initialize", "adopt"],
    },
    audit: {
      word: "Auditing rooms",
      panes: ["scope", "navigation", "plan", "rooms", "room", "review"],
      verbs: ["refresh", "partition"],
    },
    sync: {
      word: "Syncing RHVAC",
      panes: ["scope", "navigation", "plan", "rooms", "room", "review"],
      verbs: ["refresh", "sync", "retry-r10", "launch"],
    },
  },
});

export const takeoffGraph: RouteGraph<TakeoffGraphPage, TakeoffsRouteDocument> = defineRouteGraph({
  ...takeoffBase,
  name: "View adoption",
  seeds: Object.fromEntries(
    Object.entries(takeoffBase.seeds!).map(([id, seed]) => [
      id,
      {
        ...seed,
        load: async () => {
          const data = await seed.load();
          return { ...data, page: { ...data.page, stage: "adopt" as const } };
        },
      },
    ]),
  ),
  directory: {
    ...takeoffBase.directory!,
    title: "View adoption",
    blurb: "Adopt zoning regions from chosen views.",
    satellites: [{ to: "/zone-audit", label: "Zone audit" }],
  },
  subject: (p) => (p.views === "all" ? "All views" : p.views.join(", ")) || "Choose views",
  fields: {
    ...takeoffBase.fields,
    stage: { ...takeoffBase.fields.stage, schema: z.literal("adopt").default("adopt") },
  },
  transition: (_, patch) => ({ patch: { ...patch, stage: "adopt" } }),
  verbs: Object.fromEntries(
    Object.entries(takeoffBase.verbs).filter(([id]) =>
      ["refresh", "initialize", "adopt", "adoption"].includes(id),
    ),
  ),
  panes: { scope: takeoffBase.panes.scope!, adoption: takeoffBase.panes.adoption! },
  layout: split(
    "adoption-body",
    { axis: "v", sized: "start", size: 100 },
    pane("scope"),
    pane("adoption"),
  ),
  stages: {
    adopt: {
      word: "Adopting views",
      verbs: ["refresh", "initialize", "adopt"],
    },
  },
});

/** The same atlas detail layout, without the adoption-only branch. */
export const atlasLayout = split(
  "takeoff-body",
  { axis: "v", sized: "start", size: 100 },
  pane("scope"),
  split(
    "atlas-columns",
    { axis: "h", sized: "start", size: 288 },
    pane("navigation"),
    split(
      "atlas-detail",
      { axis: "v", sized: "end", size: 240 },
      pane("plan"),
      split("atlas-rooms", { axis: "h", sized: "end", size: 288 }, pane("rooms"), pane("room")),
    ),
  ),
);
