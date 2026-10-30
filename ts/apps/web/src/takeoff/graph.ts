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
} from "@pe/agent-contracts";
import { field, text } from "../../../../packages/agent-contracts/src/route-field";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
import { takeoffsAddress } from "../../../../packages/agent-contracts/src/routes/takeoffs";
import { takeoffPageSchema } from "./actions";
import { takeoffVerbs } from "./graph-actions";

export const takeoffGraphPageSchema = takeoffPageSchema
  .omit({ demo: true, panel: true, syncReview: true })
  .extend({ work: z.string().default(""), fileText: z.boolean().default(false) });
export type TakeoffGraphPage = z.output<typeof takeoffGraphPageSchema>;
const json = <S extends z.ZodType>(schema: S) =>
  field(schema, {}, { encode: JSON.stringify, decode: JSON.parse });
const a = takeoffsAddress.fields;
const rowPartitions = Object.assign(
  (row: unknown) => ((row as { zone?: string })?.zone ? ["partition"] : []),
  { ids: ["partition"] },
);
export const takeoffGraph: RouteGraph<TakeoffGraphPage, TakeoffsRouteDocument> = {
  key: "takeoffs",
  address: "takeoffs",
  name: "Takeoffs",
  needs: "project",
  work: takeoffsRouteState.schema,
  fields: {
    // TODO: kernel target transitions must reset the route action scope (views/zones/r10/stage)
    // and level/zone/room/viewport, as the embedded controller's resetTarget still does.
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
      // TODO: a kernel cell take needs a derived-patch hook to carry the first accepted room base.
      // Reading a base early changes drift semantics when a later capture precedes the first edit.
      admit: (doc, patches) =>
        patches.some(
          (patch) =>
            patch.path[0] === "edits" &&
            patch.path[2] === "edit" &&
            patch.value !== undefined &&
            !doc.bases[takeoffEditAddress(String(patch.path[1])).roomId],
        )
          ? {
              code: "not-ready",
              message:
                "Edit this room first; kernel proposal take cannot yet record its first room baseline",
            }
          : null,
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
  // TODO: kernel layout declarations need persisted seam limits and folded-pane visibility
  // for the viewport lease; the embedded Atlas still owns those device-state policies.
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
        { axis: "h", sized: "start", size: 288 },
        pane("navigation"),
        split(
          "takeoff-main",
          { axis: "v", sized: "start", size: 354 },
          pane("plan"),
          split(
            "takeoff-lower",
            { axis: "v", sized: "end", size: 180 },
            split(
              "takeoff-table",
              { axis: "h", sized: "end", size: 288 },
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
