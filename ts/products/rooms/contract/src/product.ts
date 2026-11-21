/** Rooms and Takeoffs share one product declaration. */
import { z } from "zod";
import { route } from "@pe/host-contracts/pe-api";
import {
  takeoffCaptureSchema,
  takeoffCaptureSummarySchema,
  takeoffSnapshotInput,
} from "./takeoffs.ts";
import { localOperations } from "./local-operations.ts";
import { contract } from "@pe/agent-contracts/handle";
import {
  cell,
  documentRecord,
  externalFile,
  machineFile,
  machineFileHandle,
  ownerBlob,
  product as define,
} from "@pe/agent-contracts/product";
import { field, subjectSchema } from "@pe/agent-contracts/route";
import {
  subjectCode,
  subjectOf,
  subjectRefCodeSchema,
  uniqueIdSchema,
} from "@pe/agent-contracts/subject-ref";
import { documentRefSchema } from "@pe/agent-contracts/target";
import { workWriteCommands } from "@pe/agent-contracts/write-intent";

const target = documentRefSchema;
/** A plan view's `UniqueId`. The native boundary resolves it; a name is display only. */
const view = z
  .string()
  // ADR 0028: an ElementId is no route identity. A name cannot be told from a UniqueId here; the
  // native resolver refuses whatever is not a plan of this document.
  .refine((value) => value.length > 0 && !/^[+-]?\d+$/.test(value), "Choose a plan view.");
/** A Filled Region's `UniqueId` SubjectRef: the key of the region record (ruling 14). */
const region = subjectRefCodeSchema;
/** Model XY in feet, on the view's generating level. */
const xy = z.tuple([z.number(), z.number()]);
const ring = z.array(xy).min(3);
const amount = z.number().nonnegative();
const segmentKind = z.enum(["Wall", "Zone", "Closed", "Door", "Headed", "Cased"]);
const unreadable = z.array(z.object({ parameter: z.string(), reason: z.string() }));

export const regionCode = (uniqueId: string) =>
  subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse(uniqueId) });
export const regionId = (code: string) => String(subjectOf(subjectRefCodeSchema.parse(code)).key);

const plans = contract("rooms.plans", {
  input: z.object({ target }),
  data: z.object({
    trackedRegionIds: z.array(z.string()).nullable(),
    levels: z.array(
      z.object({
        name: z.string(),
        elevationFt: z.number(),
        // Two plans of one level may share a name: `type` tells a floor plan from a ceiling plan.
        views: z.array(z.object({ view, name: z.string(), type: z.string() })),
      }),
    ),
  }),
  uses: ["rooms.roster"],
});
const regions = contract("rooms.regions", {
  // An empty view is the screen before a plan is chosen: it reads nothing and lists nothing.
  input: z.object({ target, view: z.string() }),
  data: z.object({
    /** Why the chosen plan cannot be read from this document. The plan chooser stays usable. */
    missing: z.string().nullable(),
    regions: z.array(
      z.object({
        subject: region,
        role: z.enum(["zone", "room", "held"]),
        zone: region.nullable(),
        name: z.string(),
        type: z.string(),
        ceilingFt: amount.nullable(),
        people: amount.nullable(),
        lightingW: amount.nullable(),
        equipSensible: amount.nullable(),
        equipLatent: amount.nullable(),
        ventilationCfm: amount.nullable(),
        sqft: z.number(),
        outer: ring,
        holes: z.array(ring),
        label: xy,
        runId: z.string(),
        reason: z.string().nullable(),
        touched: z.boolean(),
        locked: z.boolean(),
        stale: z.boolean(),
      }),
    ),
    /** Record entries this build cannot read. The read lists them and goes on. */
    unreadable,
  }),
  uses: ["rooms.snapshot"],
  keyedBy: { regions: { kind: "UniqueId" } },
});
// Not `rooms.trace`: that key is the native operation this reading uses.
const evidence = contract("rooms.evidence", {
  input: z.object({ target, view: z.string(), runId: z.string().optional() }),
  data: z.object({
    runId: z.string(),
    zones: z.array(
      z.object({
        zone: region,
        label: z.string(),
        rails: z.array(
          z.object({
            a: xy,
            b: xy,
            thicknessFt: z.number(),
            source: z.string(),
            category: z.string(),
          }),
        ),
        segments: z.array(z.object({ a: xy, b: xy, kind: segmentKind })),
        openings: z.array(z.object({ a: xy, b: xy, widthFt: z.number(), kind: segmentKind })),
        sqft: z.object({
          zone: z.number(),
          accepted: z.number(),
          held: z.number(),
          void: z.number(),
          excluded: z.number(),
        }),
      }),
    ),
  }),
  uses: ["rooms.trace"],
});
const planImage = contract("rooms.plan-image", {
  input: z.object({ target, view: z.string() }),
  // The raster of the 2D picture (S7). Three pixel corners tie it to model XY in feet.
  data: z.object({
    raster: z
      .object({
        href: z.string(),
        registration: z.object({
          width: z.number(),
          height: z.number(),
          topLeft: xy,
          topRight: xy,
          bottomLeft: xy,
        }),
      })
      .nullable(),
    refusal: z.string().nullable(),
  }),
  uses: ["revit.context.view-image"],
});
const adoption = contract("takeoffs.adoption", {
  input: z.object({ target, views: z.array(z.string()) }),
  data: z.object({
    missingViews: z.array(z.string()),
    /** One row per designer region on the chosen plans, with the staged choice over its default. */
    rows: z.array(
      z.object({
        /** The Work key of this row's choice: `<view UniqueId>:<elementId>`. */
        key: z.string(),
        view,
        viewName: z.string(),
        elementId: z.number(),
        /** The region's `UniqueId`: the native adopt refuses an ElementId that names another element. */
        uniqueId: z.string(),
        typeName: z.string(),
        sqft: z.number(),
        adopted: z.boolean(),
        checked: z.boolean(),
        name: z.string(),
        systemTag: z.string(),
        unreadable: z.string().nullable(),
      }),
    ),
    unreadable,
  }),
  uses: ["rooms.roster", "takeoffs.candidates", "takeoffs.snapshot"],
});
const captures = contract("takeoffs.captures", {
  input: z.object({ target, capture: z.string() }),
  data: z.object({
    captures: z.array(takeoffCaptureSummarySchema),
    saved: takeoffCaptureSchema.nullable(),
  }),
  uses: [],
});
const previous = { target, previousId: z.string().optional() };
const observations = contract("takeoffs.observations", {
  input: z.object({
    target: target.optional(),
    capture: z.string().optional(),
    text: z.boolean().optional(),
    saved: z.boolean().optional(),
    document: z.string().optional(),
  }),
  data: z.union([
    takeoffCaptureSchema.nullable(),
    z.object({ path: z.string(), text: z.string() }),
    z.array(takeoffCaptureSummarySchema),
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("empty"), target }),
      z.object({ kind: z.literal("reading"), ...previous }),
      z.object({ kind: z.literal("ready"), target, captureId: z.string() }),
      z.object({ kind: z.literal("failed"), ...previous, error: z.string() }),
    ]),
  ]),
  uses: [],
});

const room = subjectSchema(Number.MAX_SAFE_INTEGER);
const onPlan = (page: { view: string }) => ({ view: page.view });
/** Free text a person types. */
const text = { kind: "text", shape: z.string() } as const;
/** A structured value a person or Pea authors: it has a shape and no list to choose from. */
const value = <S extends z.ZodType>(shape: S) => ({ kind: "value", shape }) as const;
const count = { kind: "number", min: 0 } as const;
const edit = { needs: "project-document", effect: "command", dirties: ["snapshot"] } as const;
const directory = {
  exposure: "Main",
  group: "Calculate loads & airflow",
  listed: true,
  resume: "document",
  satellites: [],
  surfaces: { pwa: "full", tray: false, web: "full" },
} as const;

export const ROOM_FIELDS = [
  "name",
  "type",
  "ceilingFt",
  "people",
  "lightingW",
  "equipSensible",
  "equipLatent",
  "ventilationCfm",
  "role",
] as const;
const writeRegion = z.object({
  uniqueId: z.string().min(1),
  name: z.string().optional(),
  type: z.string().optional(),
  ceilingFt: amount.optional(),
  people: amount.optional(),
  lightingW: amount.optional(),
  equipSensible: amount.optional(),
  equipLatent: amount.optional(),
  ventilationCfm: amount.optional(),
  role: z.enum(["room", "zone"]).optional(),
});
/** Every staged field cell of the Rooms Work, one native `rooms.write` row per region. */
export function stagedRegions(doc: z.output<typeof roomsWork.schema>): {
  regions: z.output<typeof writeRegion>[];
} {
  const rows = new Map<string, Record<string, unknown>>();
  for (const name of ROOM_FIELDS)
    for (const [code, staged] of Object.entries(doc[name] ?? {})) {
      if (staged.edit?.value === undefined) continue;
      const uniqueId = regionId(code);
      rows.set(uniqueId, { ...rows.get(uniqueId), uniqueId, [name]: staged.edit.value });
    }
  return { regions: z.array(writeRegion).parse([...rows.values()]) };
}
const adoptItem = z.object({
  elementId: z.number().int(),
  uniqueId: z.string().min(1),
  name: z.string(),
  systemTag: z.string(),
});
const flag = (label: string) =>
  ({ kind: "enum", shape: z.literal(true), choices: [{ value: true, label }] }) as const;

export const product = define({
  id: "rooms",
  says: "Partition a plan into zones and rooms, state each room's fields, and write them to the model.",
  homes: {
    /** Role, provenance and the eight fields of every region, in one document record (ruling 14). */
    regions: documentRecord(ownerBlob("regionRecord")),
    enclosure: documentRecord(ownerBlob("partitionEnclosure")),
    registry: documentRecord(ownerBlob("takeoffRegistry")),
    /** One solve's evidence per zone, kept by the native partition. */
    traces: machineFile(machineFileHandle("runTraces")),
    r10: externalFile(".r10"),
  },
  cells: {
    name: cell(text, "subject", { label: "Name" }),
    // Text, not an enum: the region record holds the type as a string, and neither the spec, the
    // ledger nor a native read supplies a list of room types.
    type: cell(text, "subject", { label: "Type" }),
    ceilingFt: cell({ ...count, unit: "ft" }, "subject", { label: "Ceiling height" }),
    people: cell(count, "subject", { label: "People" }),
    lightingW: cell({ ...count, unit: "W" }, "subject", { label: "Lighting" }),
    equipSensible: cell(count, "subject", { label: "Equipment sensible" }),
    equipLatent: cell(count, "subject", { label: "Equipment latent" }),
    ventilationCfm: cell({ ...count, unit: "CFM" }, "subject", { label: "Ventilation" }),
    /** A person's designation of a region. */
    role: cell(
      {
        kind: "enum",
        shape: z.enum(["room", "zone"]),
        choices: [
          { value: "room", label: "Room" },
          { value: "zone", label: "Zone" },
        ],
      },
      "subject",
      { label: "Role" },
    ),
    /** A person's or Pea's mark on the plan. No command lands it, so it stays in Work. */
    marks: cell(
      value(
        z.object({
          kind: z.enum(["merge", "reject", "wall", "split"]),
          view,
          polygon: ring,
          runId: z.string(),
          regions: z.array(region).optional(),
          note: z.string().optional(),
        }),
      ),
      "name",
    ),
    // Takeoffs. Work keys use takeoffEditKey and takeoffDecisionKey.
    /** A room field's next value in RHVAC, keyed `[roomId, field]`. */
    edits: cell(value(z.union([z.string(), z.number()])), "name", { label: "Room edits" }),
    /** A designer region's adoption choice, keyed `<view UniqueId>:<elementId>`. */
    adopt: cell(
      value(
        z.object({
          checked: z.boolean().optional(),
          name: z.string().optional(),
          systemTag: z.string().optional(),
        }),
      ),
      "name",
      { label: "Adoption choices" },
    ),
    /** A person's verdict on a solver flag, keyed `[roomGuid, flag]`. */
    decisions: cell(
      {
        kind: "enum",
        shape: z.enum(["accept", "dismiss"]),
        choices: [
          { value: "accept", label: "Accept" },
          { value: "dismiss", label: "Dismiss" },
        ],
      },
      "name",
      { label: "Flag decisions" },
    ),
    /** A review flag on one shape of a zone's saved review, keyed `[zoneKey, shapeKey]`. */
    reviewFlags: cell(flag("Flagged"), "name", { label: "Review flags" }),
  },
  works: {
    rooms: [...ROOM_FIELDS, "marks"],
    takeoffs: ["edits", "adopt", "decisions", "reviewFlags"],
  },
  captures: { takeoff: takeoffCaptureSchema },
  readings: {
    plans: {
      handle: plans,
      sources: ["regions"],
      says: "rooms.plans lists each level's plan views.",
    },
    regions: {
      handle: regions,
      sources: ["regions"],
      says: "rooms.regions reads one plan's zones, rooms and held regions with their fields.",
    },
    evidence: { handle: evidence, sources: ["traces"], load: { alone: true } },
    planImage: {
      handle: planImage,
      sources: [],
      load: { alone: true, slow: "Exporting plan image", freshBy: ["document-mark"] },
    },
    adoption: {
      handle: adoption,
      sources: ["regions", "registry"],
      says: "takeoffs.adoption reads the designer regions of chosen plans with their staged adoption choices.",
    },
    captures: { handle: captures, sources: [] },
    observations: {
      handle: observations,
      sources: [],
      emits: "takeoff",
      load: {
        calls: { "takeoffs.saved": { saved: true }, "takeoffs.snapshot": { snapshot: true } },
      },
    },
  },
  http: {
    [observations.key]: {
      ...route(
        "GET",
        "/takeoffs/observations",
        z.undefined(),
        observations.data,
        "read",
        "gateway",
        "read",
      ),
      axes: observations.axes,
    },
  },
  files: {
    observation: { input: observations.input, output: observations.data },
    "takeoff-capture": {
      input: takeoffSnapshotInput,
      output: takeoffCaptureSchema,
      emits: "takeoff",
    },
  },
  local: localOperations,
  commands: {
    ...workWriteCommands("rooms", "rooms.partition", {
      ...edit,
      says: "Partition every zone on a plan into rooms, keeping locked and matched rooms.",
      input: z.object({ view, rejected: z.array(ring).optional() }),
      native: ["takeoffs.record-replacements", "rooms.partition"],
      writes: { regions: [], traces: [] },
    }),
    ...workWriteCommands("rooms", "rooms.draw", {
      ...edit,
      says: "Draw one locked room, or one zone, from loops on a plan.",
      input: z.object({
        view,
        loops: z.array(ring).min(1),
        name: z.string().optional(),
        role: z.enum(["room", "zone"]).optional(),
      }),
      native: ["takeoffs.record-replacements", "rooms.draw"],
      writes: { regions: [] },
    }),
    ...workWriteCommands("rooms", "rooms.merge", {
      ...edit,
      says: "Combine two or more touching rooms of one zone into one locked room.",
      input: z.object({ view, regions: z.array(region).min(2), name: z.string().optional() }),
      native: ["takeoffs.record-replacements", "rooms.merge"],
      writes: { regions: [] },
    }),
    ...workWriteCommands("takeoffs", "takeoffs.adopt", {
      ...edit,
      says: "Adopt selected regions using the submitted names and system tags.",
      input: z.object({
        views: z.array(z.object({ view, items: z.array(adoptItem).min(1) })).min(1),
      }),
      dirties: ["snapshot", "views", "candidates"],
      native: ["takeoffs.record-replacements", "takeoffs.adopt"],
      writes: { regions: [], registry: [], enclosure: [] },
    }),
    ...workWriteCommands("takeoffs", "takeoffs.partition", {
      ...edit,
      says: "Partition the selected adopted zone.",
      input: z.object({
        zoneRegion: z.number().int(),
        view,
        zoneName: z.string(),
        zoneUniqueId: z.string(),
        runId: z.string().optional(),
      }),
      dirties: ["snapshot", "views"],
      native: ["takeoffs.record-replacements", "takeoffs.partition"],
      writes: { regions: [] },
    }),
    // The selected RHVAC file is an external application document with its own authority.
    ...workWriteCommands("takeoffs", "takeoffs.sync", {
      ...edit,
      says: "Insert eligible rooms, preserve system/link behavior, and update linked staged rooms in RHVAC.",
      input: z.object({
        path: z.string().min(1),
        zones: z.array(z.string()).default([]),
        captureId: z.string().min(1),
        fileVersion: z.string().min(1),
      }),
      dirties: ["snapshot", "rhvac-open"],
      native: [
        "takeoffs.record-replacements",
        "takeoffs.rhvac-links.preflight",
        "takeoffs.rhvac-links",
      ],
      writes: { regions: [], r10: ["edits"] },
    }),
  },
  // The staged room fields reach the region record through the platform's sheet pair
  // (`sheet.plan`, `sheet.apply`); the host body answers for each cell (ruling 7).
  sheetWrites: {
    route: "rooms",
    writes: { regions: ROOM_FIELDS },
    native: {
      plan: ["rooms.roster", "takeoffs.record-replacements"],
      apply: ["rooms.roster", "takeoffs.record-replacements", "rooms.write"],
    },
  },
  routes: {
    rooms: {
      name: "Rooms",
      directory: {
        ...directory,
        aliases: ["room", "zone", "space", "partition"],
        icon: "LayoutGrid",
        label: "Rooms",
        runtimeNeed: "Revit for model reads and writes",
        summary: "Partition a plan into rooms and state each room's fields",
      },
      fields: {
        view: field(z.string(), "", "query", "push"),
        room: field(room, { kind: "ids", ids: [] }, "subject", "push"),
      },
      subject: {
        field: "room",
        noun: "room",
        pane: "roster",
        options: (data: z.output<typeof regions.data>) =>
          data.regions.map((row) => ({ id: row.subject, label: row.name })),
      },
      core: ["regions", onPlan],
      reads: { plans: "plans", evidence: ["evidence", onPlan], planImage: ["planImage", onPlan] },
      panes: ["roster", "plan", "fields"],
    },
    takeoffs: {
      name: "View adoption",
      directory: {
        ...directory,
        aliases: ["manual", "j", "loads", "rhvac", "zones"],
        icon: "Map",
        label: "Manual J",
        runtimeNeed: "Revit for model actions; browsing saved data is separate",
        summary: "Adopt zoning regions from chosen views.",
      },
      fields: {
        views: field(z.array(z.string()), [], "query", "push"),
        capture: field(z.string(), "", "query", "push"),
      },
      core: ["adoption", (page: { views: readonly string[] }) => ({ views: [...page.views] })],
      reads: {
        plans: "plans",
        captures: ["captures", (page: { capture: string }) => ({ capture: page.capture })],
      },
      panes: ["adoption"],
    },
  },
});

/** Each Work by name: a route declaration imports it, and the host registry binds the same value. */
export const roomsWork = product.tools.rooms.work;
export const takeoffsWork = product.tools.takeoffs.work;
