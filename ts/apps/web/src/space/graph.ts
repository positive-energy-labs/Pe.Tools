import { defineRouteGraph } from "@pe/agent-contracts";
import { spaceQueries, matchingScene } from "./sources";
import type { ReadingState } from "#/shell/readings";
import { cutPolygons } from "./state";
import { z } from "zod";
import { gate, pane, split, routeAddress, type RouteGraph } from "@pe/agent-contracts";
import { field, type ScalarSchema } from "../../../../packages/agent-contracts/src/route-field";
import { spaceAddress } from "../../../../packages/agent-contracts/src/routes/space";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
import { queryVerb } from "#/shell/verbs";
import { sceneRequest } from "#/scene/host";
import { CONTEXT_DEFAULT } from "#/scene/picture/picture";
import { refuse } from "#/route/refusal";
import { ENCODINGS } from "./layers";
import { regionSchema, spaceReads, type SpaceReadKey, type SpaceAnswerKey } from "./reads";

const jsonField = <S extends z.ZodType>(
  schema: ScalarSchema<S>,
) =>
  field(
    schema,
    { url: "replace", agent: "set" },
    {
      encode: JSON.stringify,
      decode: (text) => {
        try {
          return JSON.parse(text);
        } catch (error) {
          console.warn("ts/apps/web/src/space/graph.ts: fallback after failure", error);
          return undefined;
        }
      },
    },
  );
const parameters = {
  region: jsonField(regionSchema.nullable().default(null)),
  treeInput: jsonField(
    spaceReads["revit.detail.space-tree"].input
      .omit({ region: true })
      .default({ source: 0, maxDepth: 4 }),
  ),
  sliceInput: jsonField(
    z.object({ z0: z.number().finite(), z1: z.number().finite() }).default({ z0: 0, z1: 10 }),
  ),
  probeInput: jsonField(
    spaceReads["revit.detail.space-probe"].input.omit({ region: true }).default({ at: [0, 0, 5] }),
  ),
  sweepInput: jsonField(
    spaceReads["revit.detail.space-sweep"].input.omit({ region: true }).default({
      polyline: [
        [0, 0, 9],
        [20, 0, 9],
      ],
      widthFt: 1,
      heightFt: 1,
      clearanceFt: 0.5,
    }),
  ),
  encoding: field(z.enum(ENCODINGS).default("category"), { url: "replace" }),
  row: field(
    z.number().int().nullable().default(null),
    {},
    { encode: (n) => (n === null ? "" : String(n)), decode: (s) => (s === "" ? null : Number(s)) },
  ),
};
const fields = { ...spaceAddress.fields, ...parameters };
export const spacePageSchema = routeAddress("space").schema.extend({
  region: parameters.region.schema,
  treeInput: parameters.treeInput.schema,
  sliceInput: parameters.sliceInput.schema,
  probeInput: parameters.probeInput.schema,
  sweepInput: parameters.sweepInput.schema,
  encoding: parameters.encoding.schema,
  row: parameters.row.schema,
});
export type SpacePage = z.output<typeof spacePageSchema>;

const read = (key: SpaceReadKey, label: string) =>
  queryVerb(
    spaceQueries[key],
    {
      label,
      input: spaceReads[key].input,
      review: "none",
    },
    {
      ready: ({ snapshot }, input) =>
        snapshot.target.kind !== "document"
          ? "Choose a document"
          : (label === "capture" || label === "load context") &&
              !(input as { region?: unknown }).region &&
              !(input as { elementIds: number[] }).elementIds.length
            ? "Name host element ids to capture"
            : null,
    },
  );
export const spaceGraph: RouteGraph<SpacePage, null> = defineRouteGraph({
  directory: {
    path: "/space",
    title: "Space",
    label: "MEP context",
    exposure: "Preview",
    runtimeNeed: "Revit for capture; saved scenes open without Revit",
    icon: "Boxes",
    category: "Coordinate model data",
    blurb:
      "Inspect real model geometry, select elements, and draw straight or bent sections locally.",
    aliases: ["3d", "mesh", "section", "viewer", "spatial", "context"],
    listed: true,
    satellites: [],
    surfaces: {
      web: "full",
      pwa: "full",
      tray: false,
    },
  },
  key: "space",
  address: "space",
  name: "Space",
  seeds: {
    fixture: {
      title: "Spatial inspection",
      load: () => import("./graph-seeds").then((m) => m.spaceSeeds["fixture"]!),
    },
  },
  needs: "document",
  subjectField: {
    field: "region",
    noun: "region",
    keyKind: "name",
    roster: "region",
    detail: "scene",
    pane: "picture",
  },
  fields: {
    ...threadListFields,
    ...fields,
    selected: { ...fields.selected, role: "selection" },
    row: { ...fields.row, url: false },
  },
  readings: {
    region: { kind: "derive", args: (page) => page.region },
    scene: {
      args: ({ scene }) => scene,
    },
    answers: {
      kind: "derive",
      args: ({ scene }) => scene,
    },
  },
  verbs: {
    capture: read("revit.detail.space-scene", "capture"),
    context: read("revit.detail.space-scene", "load context"),
    detailed: read("revit.detail.space-scene", "Read detailed"),
    status: read("revit.detail.space-status", "read status"),
    rows: read("revit.detail.space-rows", "read rows"),
    tree: read("revit.detail.space-tree", "read tree"),
    slice: read("revit.detail.space-slice", "read slice"),
    probe: read("revit.detail.space-probe", "read probe"),
    sweep: read("revit.detail.space-sweep", "read sweep"),
  },
  panes: {
    picture: {
      label: "Space",
      purpose: "Inspect captured geometry, cuts and query answers",
      draws: ["scene", "answers"],
    },
    facts: {
      label: "Space facts",
      purpose: "Edit axis cuts and read answer layers",
      draws: ["scene", "answers"],
      verbs: Object.assign((row: { verb: string }) => [row.verb], {
        ids: [
          "capture",
          "context",
          "detailed",
          "status",
          "rows",
          "tree",
          "slice",
          "probe",
          "sweep",
        ],
      }),
    },
  },
  layout: split(
    "space",
    { axis: "h", sized: "end", size: 320 },
    pane("picture"),
    gate("hasFacts", pane("facts")),
  ),
  predicates: {
    hasFacts: (page) =>
      page.mode !== "3d" ||
      ["levels", "boxes", "tree", "slice", "probe", "sweep"].some((layer) =>
        (page.layers as readonly string[]).includes(layer),
      ),
  },
  stages: {
    inspect: {
      word: "Inspecting",
      verbs: ["capture", "context"],
      teach:
        "Capture host element ids or load their context, then orbit, pick, hide, isolate and cut. Saved scene links reopen artifacts without capturing. Keys 1â€“4 switch 3D, Top, North and East. Escape returns an axis to its saved 3D pose. Each cut constrains the picture by intersection.",
    },
  },

  transition: (current, patch, origin, scope) => {
    if (
      origin !== "url" &&
      origin !== "initial" &&
      ["selected", "hidden", "isolated", "cuts"].some((key) => Object.hasOwn(patch, key))
    ) {
      const candidate = { ...current, ...patch };
      const reading = scope?.readings.scene;
      const loaded = reading ? matchingScene(current, reading as ReadingState) : null;
      const named = [
        candidate.selected,
        ...(candidate.hidden === "all" ? [] : candidate.hidden),
        ...(candidate.isolated === "all" ? [] : candidate.isolated),
      ].filter((key): key is string => key !== null);
      if (
        (named.length || Object.hasOwn(patch, "cuts")) &&
        (!loaded || loaded.id !== candidate.scene)
      )
        return {
          refusal: refuse(
            "not-ready",
            "Load this scene before naming its elements or changing its cuts",
          ),
        };
      const missing = named.find((key) => !loaded?.members.has(key));
      if (missing)
        return { refusal: refuse("not-ready", `Element is not in this loaded scene: ${missing}`) };
      if (loaded && Object.hasOwn(patch, "cuts")) {
        try {
          cutPolygons(candidate.cuts, loaded.metadata.bounds);
        } catch (cause) {
          return { refusal: refuse("not-ready", (cause as Error).message) };
        }
      }
    }
    const normalized =
      Object.hasOwn(patch, "mode") &&
      patch.mode !== current.mode &&
      !Object.hasOwn(patch, "viewport")
        ? { ...patch, viewport: null }
        : patch;
    const conflict = spaceAddress.conflict({ ...current, ...normalized });
    return conflict
      ? origin === "url" || origin === "initial"
        ? { patch: { ...normalized, viewport: null } }
        : { refusal: refuse("not-ready", conflict.error) }
      : { patch: normalized };
  },
});

export const spaceBinding = (id: string, row: unknown, { page }: { page: SpacePage }) => ({
  subject: null,
  args:
    id === "capture" || id === "context" || id === "detailed"
      ? {
          ...sceneRequest(
            (row as { input?: { elementIds?: number[] } } | undefined)?.input?.elementIds ?? [],
            false,
            15,
            CONTEXT_DEFAULT,
          ),
          ...(page.region ? { region: page.region } : {}),
          elementIds: page.region
            ? []
            : ((row as { input?: { elementIds?: number[] } } | undefined)?.input?.elementIds ?? []),
          focusOnly: false,
          contextRepresentation: id === "detailed" ? "meshes" : CONTEXT_DEFAULT,
        }
      : {
          ...((row as { input?: object } | undefined)?.input ??
            (page as unknown as Record<string, object>)[`${id}Input`] ??
            {}),
          ...(page.region ? { region: page.region } : {}),
        },
});
export const answerKeys: readonly SpaceAnswerKey[] = [
  "status",
  "rows",
  "tree",
  "slice",
  "probe",
  "sweep",
];
