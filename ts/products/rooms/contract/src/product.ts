/**
 * Rooms and Takeoffs: one product with two routes (ruling 6 of docs/features/routes/MAP.md).
 * Clean-room: written from the Rooms spec and the native operation contracts. S9 builds the host
 * bodies and the screen against this value; S10 fills the Takeoffs route.
 */
import { z } from "zod";
import { contract } from "@pe/agent-contracts/handle";
import {
  cell,
  documentRecord,
  machineFile,
  product as define,
  type NativeHome,
} from "@pe/agent-contracts/product";
import { field, hostRead, read, subjectSchema } from "@pe/agent-contracts/route";
import { subjectRefCodeSchema } from "@pe/agent-contracts/subject-ref";
import { documentRefSchema } from "@pe/agent-contracts/target";

// Owed to S8a: C# declares both homes and generates these handles (ruling 4), and these two lines
// become one import. Until then this module type-checks and cannot run, so its package exports nothing.
declare const regionRecord: NativeHome<"owner-blob">;
declare const runTraces: NativeHome<"machine-file">;

const target = documentRefSchema;
/** A plan view's `UniqueId`. The host resolves Revit's numeric view id at the native boundary. */
const view = z.string().min(1);
/** A Filled Region's `UniqueId` SubjectRef: the key of the region record (ruling 14). */
const region = subjectRefCodeSchema;
/** Model XY in feet, on the view's generating level. */
const xy = z.tuple([z.number(), z.number()]);
const ring = z.array(xy).min(3);
const amount = z.number().nonnegative();
const segmentKind = z.enum(["Wall", "Zone", "Closed", "Door", "Headed", "Cased"]);

const plans = contract("rooms.plans", {
  input: z.object({ target }),
  data: z.object({
    levels: z.array(
      z.object({
        name: z.string(),
        elevationFt: z.number(),
        views: z.array(z.object({ view, name: z.string() })),
      }),
    ),
  }),
  uses: ["rooms.roster"],
});
const regions = contract("rooms.regions", {
  input: z.object({ target, view }),
  data: z.object({
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
    unreadable: z.array(z.object({ subject: region.nullable(), reason: z.string() })),
  }),
  uses: ["rooms.snapshot"],
  keyedBy: { regions: { kind: "UniqueId" } },
});
const trace = contract("rooms.trace", {
  input: z.object({ target, view, runId: z.string().optional() }),
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
  input: z.object({ target, view }),
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

const room = subjectSchema(Number.MAX_SAFE_INTEGER);
const onPlan = (page: { view: string }) => ({ view: page.view });
const roster = read(hostRead(regions), onPlan);
const edit = { needs: "project-document", effect: "command", dirties: ["snapshot"] } as const;

export const product = define({
  id: "rooms",
  says: "Partition a plan into zones and rooms, state each room's fields, and write them to the model.",
  homes: {
    /** Role, provenance and the eight fields of every region, in one document record (ruling 14). */
    regions: documentRecord(regionRecord),
    /** One solve's evidence per zone, kept by the native partition. */
    traces: machineFile(runTraces),
  },
  cells: {
    name: cell(z.string(), "subject"),
    type: cell(z.string(), "subject"),
    ceilingFt: cell(amount, "subject"),
    people: cell(amount, "subject"),
    lightingW: cell(amount, "subject"),
    equipSensible: cell(amount, "subject"),
    equipLatent: cell(amount, "subject"),
    ventilationCfm: cell(amount, "subject"),
    /** A person's designation of a region. */
    role: cell(z.enum(["room", "zone"]), "subject"),
    /** A person's or Pea's mark on the plan. No command lands it, so it stays in Work. */
    marks: cell(
      z.object({
        kind: z.enum(["merge", "reject", "wall", "split"]),
        view,
        polygon: ring,
        runId: z.string(),
        regions: z.array(region).optional(),
        note: z.string().optional(),
      }),
      "name",
    ),
  },
  readings: {
    plans: { handle: plans, sources: [], says: "rooms.plans lists each level's plan views." },
    regions: {
      handle: regions,
      sources: ["regions"],
      says: "rooms.regions reads one plan's zones, rooms and held regions with their fields.",
    },
    trace: { handle: trace, sources: ["traces"], load: { alone: true } },
    planImage: {
      handle: planImage,
      sources: [],
      load: { alone: true, slow: "Exporting plan image", freshBy: ["document-mark"] },
    },
  },
  commands: {
    "rooms.partition": {
      ...edit,
      says: "Partition every zone on a plan into rooms, keeping locked and matched rooms.",
      input: z.object({ view, rejected: z.array(ring).optional() }),
      native: ["rooms.partition"],
      writes: { regions: [], traces: [] },
    },
    "rooms.draw": {
      ...edit,
      says: "Draw one locked room, or one zone, from loops on a plan.",
      input: z.object({
        view,
        loops: z.array(ring).min(1),
        name: z.string().optional(),
        role: z.enum(["room", "zone"]).optional(),
      }),
      native: ["rooms.draw"],
      writes: { regions: [] },
    },
    "rooms.write": {
      ...edit,
      says: "Write the staged room fields and designations, and answer for each cell (ruling 7).",
      input: z.object({}),
      native: ["rooms.write"],
      writes: {
        regions: [
          "name",
          "type",
          "ceilingFt",
          "people",
          "lightingW",
          "equipSensible",
          "equipLatent",
          "ventilationCfm",
          "role",
        ],
      },
    },
    "rooms.merge": {
      ...edit,
      says: "Combine two or more touching rooms of one zone into one locked room.",
      input: z.object({ view, regions: z.array(region).min(2), name: z.string().optional() }),
      native: ["rooms.merge"],
      writes: { regions: [] },
    },
  },
  routes: {
    rooms: {
      key: "rooms",
      fields: {
        view: field(z.string(), "", "query", "push"),
        room: field(room, { kind: "ids", ids: [] }, "subject", "push"),
      },
      subject: {
        field: "room",
        noun: "room",
        pane: "roster",
        read: roster,
        options: (data: z.output<typeof regions.data>) =>
          data.regions.map((row) => ({ id: row.subject, label: row.name })),
      },
      core: roster,
      reads: {
        plans: read(hostRead(plans)),
        trace: read(hostRead(trace), onPlan),
        planImage: read(hostRead(planImage), onPlan),
      },
      panes: ["roster", "plan", "fields"],
    },
    // Owed to S10: the Takeoffs address, subject, readings and panes.
    takeoffs: { key: "takeoffs", fields: {}, panes: [] },
  },
});
