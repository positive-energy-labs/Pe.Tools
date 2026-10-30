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
import { field, text } from "../../../../packages/agent-contracts/src/route-field";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
import { takeoffsAddress } from "../../../../packages/agent-contracts/src/routes/takeoffs";
import { takeoffPageSchema } from "./actions";
import { withEditBases } from "./projections";
import { takeoffVerbs } from "./graph-actions";

export const takeoffGraphPageSchema = takeoffPageSchema
  .omit({ panel: true, syncReview: true })
  .extend({ work: z.string().default(""), fileText: z.boolean().default(false) });
export type TakeoffGraphPage = z.output<typeof takeoffGraphPageSchema>;
const json = <S extends z.ZodType>(schema: S) =>
  field(schema, {}, { encode: JSON.stringify, decode: JSON.parse });
const a = takeoffsAddress.fields;
const rowPartitions = Object.assign(
  (row: unknown) => ((row as { zone?: string })?.zone ? ["partition"] : []),
  { ids: ["partition"] },
);
import { takeoffSeeds, DEMO_CANDIDATES } from "./seeds";
export const takeoffGraph: RouteGraph<TakeoffGraphPage, TakeoffsRouteDocument> = {
  key: "takeoffs",
  address: "takeoffs",
  name: "Takeoffs",
  seeds: Object.fromEntries(
    Object.entries(takeoffSeeds).map(([name, seed]) => [
      name,
      {
        ...seed,
        queries: {
          "takeoffs.snapshot": seed.readings.snapshot,
          "rhvac.open": { path: "C:/Fixtures/projectA.r10" },
        },
        readings: {
          candidates: DEMO_CANDIDATES,
          ownerCrops: null,
          plan: null,
          rhvacVersion: null,
          receipts: [],
          captures: [],
          saved: null,
          text: null,
          ...seed.readings,
        },
      },
    ]),
  ),
  needs: "project",
  work: takeoffsRouteState.schema,
  capture: "work",
  workSubject: "work",
  resetOnTarget: ["views", "zones", "r10", "stage", "level", "zone", "room", "viewport"],
  fields: {
    threadSearch: { ...threadListFields.threadSearch, role: "query" },
    threadSort: { ...threadListFields.threadSort, role: "query" },
    level: { ...a.level, role: "selection", agent: "read" },
    zone: { ...a.zone, role: "selection", agent: "read" },
    room: { ...a.room, role: "selection", agent: "read" },
    viewport: { ...a.viewport, role: "pose" },
    work: { ...field(text(), {}), role: "subject" },
    views: { ...json(takeoffGraphPageSchema.shape.views), role: "selection", url: false },
    zones: { ...json(takeoffGraphPageSchema.shape.zones), role: "selection", url: false },
    r10: { ...field(text(), {}), role: "draft", url: false },
    stage: { ...field(takeoffGraphPageSchema.shape.stage, {}), role: "stage", url: false },
    fileText: { ...json(takeoffGraphPageSchema.shape.fileText), role: "transient" },
  },
  transition: (current, patch) => ({
    patch: {
      ...patch,
      ...(current.work && patch.stage !== undefined && patch.stage !== current.stage
        ? { work: "" }
        : {}),
      ...(patch.level !== undefined && patch.level !== current.level ? { viewport: null } : {}),
    },
  }),
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
    snapshot: { kind: "use", source: "takeoffs.snapshot", retire: "page", args: (p) => p.work },
    candidates: {
      kind: "use",
      source: "takeoffs.candidates",
      retire: "page",
      args: (p) => [p.work, p.views],
    },
    ownerCrops: {
      kind: "use",
      source: "takeoffs.ownerCrops",
      retire: "page",
      deps: ["snapshot", "saved"],
      args: (p) => [p.work, p.level, p.views],
    },
    plan: {
      kind: "use",
      source: "takeoffs.plan",
      retire: "page",
      deps: ["snapshot", "saved", "ownerCrops"],
      args: (p) => [p.work, p.level, p.views],
    },
    rhvacVersion: {
      kind: "use",
      source: "takeoffs.rhvacVersion",
      retire: "page",
      args: (p) => [p.work, p.r10],
    },
    receipts: { kind: "use", source: "takeoffs.receipts", retire: "target" },
    captures: { kind: "use", source: "takeoffs.captures", retire: "never" },
    saved: { kind: "use", source: "takeoffs.saved", retire: "page", args: (p) => p.work },
    text: {
      kind: "use",
      source: "takeoffs.text",
      retire: "page",
      args: (p) => [p.work, p.fileText],
    },
  },
  verbs: takeoffVerbs,
  panes: {
    scope: {
      label: "Takeoff scope",
      purpose: "Choose views, zones and an RHVAC file",
      draws: ["snapshot", "saved", "captures", "rhvacVersion"],
      verbs: [],
    },
    adoption: {
      label: "Adopt zoning regions",
      purpose: "Stage designer region names and system tags",
      draws: ["candidates"],
      verbs: [],
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
      verbs: [],
    },
    rooms: {
      label: "Rooms",
      purpose: "Edit Manual J room data and decide calls",
      draws: ["snapshot", "saved"],
      verbs: [],
    },
    room: { label: "Room details", purpose: "Inspect the selected room", draws: [], verbs: [] },
    review: {
      label: "Review",
      purpose: "Review native partition evidence and authored proposals",
      draws: ["receipts", "text"],
      verbs: [],
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
      panes: ["scope", "adoption", "navigation", "plan", "rooms", "room", "review"],
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
};
