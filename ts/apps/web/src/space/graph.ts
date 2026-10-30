import { spaceQueries, matchingScene } from "./sources";
import type { ReadingState } from "#/shell/readings";
import { cutPolygons } from "./state";
import { z } from "zod";
import { gate, pane, split, routeAddress, type RouteGraph } from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { spaceAddress } from "../../../../packages/agent-contracts/src/routes/space";
import { threadListFields } from "../../../../packages/agent-contracts/src/routes/shared";
import { queryVerb } from "#/shell/verbs";
import { sceneRequest } from "#/scene/host";
import { refuse } from "#/route/refusal";
import { ENCODINGS } from "./layers";
import { spaceReads, type SpaceReadKey, type SpaceAnswerKey } from "./reads";

const jsonField = <S extends z.ZodType>(schema: S) =>
  field(
    schema,
    { url: "replace", agent: "set" },
    {
      encode: JSON.stringify,
      decode: (text) => {
        try {
          return JSON.parse(text);
        } catch {
          return undefined;
        }
      },
    },
  );
const parameters = {
  treeInput: jsonField(
    spaceReads["revit.detail.space-tree"].input.default({ source: 0, maxDepth: 4 }),
  ),
  sliceInput: jsonField(spaceReads["revit.detail.space-slice"].input.default({ z0: 0, z1: 10 })),
  probeInput: jsonField(spaceReads["revit.detail.space-probe"].input.default({ at: [0, 0, 5] })),
  sweepInput: jsonField(
    spaceReads["revit.detail.space-sweep"].input.default({
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
          : label === "capture" && !(input as { elementIds: number[] }).elementIds.length
            ? "Name host element ids to capture"
            : null,
    },
  );
import { spaceSeeds } from "./graph-seeds";
export const spaceGraph: RouteGraph<SpacePage, null> = {
  key: "space",
  address: "space",
  name: "Space",
  seeds: spaceSeeds,
  needs: "document",
  fields: {
    threadSearch: { ...threadListFields.threadSearch, role: "pose" },
    threadSort: { ...threadListFields.threadSort, role: "pose" },
    scene: { ...fields.scene, role: "pose" },
    ids: { ...fields.ids, role: "subject" },
    mode: { ...fields.mode, role: "pose" },
    viewport: { ...fields.viewport, role: "pose" },
    cuts: { ...fields.cuts, role: "pose" },
    selected: { ...fields.selected, role: "pose" },
    hidden: { ...fields.hidden, role: "pose" },
    isolated: { ...fields.isolated, role: "pose" },
    layers: { ...fields.layers, role: "pose" },
    encoding: { ...fields.encoding, role: "pose" },
    row: { ...fields.row, role: "pose", url: false },
    treeInput: { ...fields.treeInput, role: "pose" },
    sliceInput: { ...fields.sliceInput, role: "pose" },
    probeInput: { ...fields.probeInput, role: "pose" },
    sweepInput: { ...fields.sweepInput, role: "pose" },
  },
  readings: {
    scene: {
      kind: "use",
      source: "space.scene",
      args: ({ scene }) => scene,
      retire: "page",
    },
    answers: {
      kind: "derive",
      source: "space.answers",
      args: ({ scene }) => scene,
      retire: "page",
    },
  },
  verbs: {
    capture: read("revit.detail.space-scene", "capture"),
    context: read("revit.detail.space-scene", "load context"),
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
      verbs: [],
    },
    facts: {
      label: "Space facts",
      purpose: "Edit axis cuts and read answer layers",
      draws: ["scene", "answers"],
      verbs: Object.assign((row: { verb: string }) => [row.verb], {
        ids: ["status", "rows", "tree", "slice", "probe", "sweep"],
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
      panes: ["picture", "facts"],
      verbs: ["capture", "context"],
      teach:
        "Capture host element ids or load their context, then orbit, pick, hide, isolate and cut. Saved scene links reopen artifacts without capturing. Keys 1â€“4 switch 3D, Top, North and East. Escape returns an axis to its saved 3D pose. Each cut constrains the picture by intersection.",
    },
  },
  pick: false,
  transition: (current, patch, origin, scope) => {
    if (
      origin !== "url" &&
      origin !== "initial" &&
      ["selected", "hidden", "isolated", "cuts"].some((key) => Object.hasOwn(patch, key))
    ) {
      const candidate = { ...current, ...patch };
      const reading = scope?.readings.scene;
      const loaded = reading ? matchingScene(current, reading as ReadingState) : null;
      const named = [candidate.selected, ...candidate.hidden, ...(candidate.isolated ?? [])].filter(
        (key): key is string => key !== null,
      );
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
};

export const spaceBinding = (id: string, row: unknown, { page }: { page: SpacePage }) => ({
  subject: null,
  args:
    id === "capture" || id === "context"
      ? {
          ...sceneRequest(
            page.ids.filter((n) => Number.isSafeInteger(n) && n > 0),
            false,
          ),
          elementIds: page.ids,
          focusOnly: id === "capture",
          contextRepresentation: id === "capture" ? "none" : "boxes",
        }
      : ((row as { input?: unknown } | undefined)?.input ??
        (page as unknown as Record<string, unknown>)[`${id}Input`] ??
        {}),
});
export const answerKeys: readonly SpaceAnswerKey[] = [
  "status",
  "rows",
  "tree",
  "slice",
  "probe",
  "sweep",
];
