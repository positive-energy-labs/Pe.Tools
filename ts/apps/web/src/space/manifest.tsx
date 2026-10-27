/**
 * The static /space contract: see what `Pe.Revit.Space` collects about one document, how its rows
 * group, and how a drawn thing ties to its Revit or DWG source. The address (`routeAddress("space")`)
 * carries the scene hash, the subject ids, the mode, the viewport, the cuts and the visibility; the
 * Page adds the layers, the row encoding and each answer the verbs read.
 *
 * Readings: `scene`, the PSC1 artifact `page.scene` names, fetched and decoded by the route
 * (`useSceneArtifact`) and provided; a URL read never captures. Only `capture` and `context` write a
 * new scene. Every answer layer is one verb's result held on the Page, never a render-time fetch.
 */
import { z } from "zod";
import { routeAddress, spaceElementKey } from "@pe/agent-contracts";
import type { OpKey, OpRequestOf, OpResponseOf } from "@pe/host-contracts/operation-types";

import { defineRoute, type Ctx } from "#/route/manifest";
import { NATIVE_READ_WAIT_S } from "#/route/waits";
import { sceneRequest } from "#/scene/host";
import type { Psc1Metadata } from "#/scene/psc1";
import { refuse } from "#/route/refusal";
import { cutPolygons } from "./state";

import { ENCODINGS } from "./layers";

/** An answer and the request it answered: a layer draws both (the band, the point, the path). */
export type Answer<K extends OpKey> = { request: OpRequestOf<K>; response: OpResponseOf<K> };
const answer = <K extends OpKey>() => z.custom<Answer<K>>().nullable().default(null);

const spacePageSchema = routeAddress("space").schema.extend({
  /** What a row box's colour means (`ENCODING_SAYS`). Page only. */
  encoding: z.enum(ENCODINGS).default("category"),
  /** The row box the person picked, by its index in `rows`; null = none. Page only. */
  row: z.number().int().nullable().default(null),
  status: answer<"revit.detail.space-status">(),
  rows: answer<"revit.detail.space-rows">(),
  tree: answer<"revit.detail.space-tree">(),
  slice: answer<"revit.detail.space-slice">(),
  probe: answer<"revit.detail.space-probe">(),
  sweep: answer<"revit.detail.space-sweep">(),
});

/** The artifact currently decoded by this route, not the effect-provided Reading mirror. */
export type LoadedSpaceScene = {
  id: SpacePage["scene"];
  metadata: Psc1Metadata;
  members: ReadonlySet<string>;
};

export function spaceSceneMembers(metadata: Psc1Metadata): ReadonlySet<string> {
  const pair = (documentKey: string, linkInstanceId?: number | null) =>
    JSON.stringify([documentKey, linkInstanceId ?? null]);
  const sources = new Set(
    metadata.sources
      .filter(
        (source) =>
          source.linkInstanceId != null || source.documentKey === metadata.stamp.hostDocumentKey,
      )
      .map((source) => pair(source.documentKey, source.linkInstanceId)),
  );
  return new Set(
    metadata.elements
      .filter((element) =>
        sources.has(pair(element.handle.documentKey, element.handle.linkInstanceId)),
      )
      .map((element) => spaceElementKey(element.handle)),
  );
}

/** URL restoration is forgiving; explicit Page moves are checked by the bound transition. */
export function reconcileSpaceMembers(
  page: SpacePage,
  scene: LoadedSpaceScene,
): Partial<SpacePage> {
  if (page.scene !== scene.id) return {};
  const members = scene.members;
  const patch: Partial<SpacePage> = {};
  if (page.selected !== null && !members.has(page.selected)) patch.selected = null;
  const hidden = page.hidden.filter((key) => members.has(key));
  if (hidden.length !== page.hidden.length) patch.hidden = hidden;
  if (page.isolated !== null) {
    const isolated = page.isolated.filter((key) => members.has(key));
    if (isolated.length !== page.isolated.length) patch.isolated = isolated;
  }
  return patch;
}

/** Every explicit human, action and Pea move crosses the same loaded-scene guard. */
export function bindSpaceManifest(readScene: () => LoadedSpaceScene | null): typeof manifest {
  return {
    ...manifest,
    transition: (current, patch, origin) => {
      const normalized = manifest.transition?.(current, patch, origin) ?? { patch };
      if ("refusal" in normalized) return normalized;
      if (origin === "url" || origin === "initial") return normalized;
      const candidate = { ...current, ...normalized.patch };
      const scene = readScene();
      const matching = scene && scene.id === candidate.scene ? scene : null;
      const named = [candidate.selected, ...candidate.hidden, ...(candidate.isolated ?? [])].filter(
        (key): key is string => key !== null,
      );
      if (named.length) {
        if (!matching)
          return { refusal: refuse("not-ready", "Load this scene before naming its elements") };
        const missing = named.find((key) => !matching.members.has(key));
        if (missing)
          return {
            refusal: refuse("not-ready", `Element is not in this loaded scene: ${missing}`),
          };
      }
      if (Object.hasOwn(patch, "cuts")) {
        if (!matching)
          return { refusal: refuse("not-ready", "Load this scene before changing its cuts") };
        try {
          cutPolygons(candidate.cuts, matching.metadata.bounds);
        } catch (cause) {
          return {
            refusal: refuse("not-ready", cause instanceof Error ? cause.message : String(cause)),
          };
        }
      }
      return normalized;
    },
  };
}
export type SpacePage = z.infer<typeof spacePageSchema>;
type SpaceCtx = Ctx<never, "scene", SpacePage>;

const none = z.void() as unknown as z.ZodType<never>;
const local = { needs: "host", actor: "any" } as const;
const push = { history: "push" } as const;

/** A capture of `ids` (alone, or with what is around them) lands as the page's new scene. */
const capture = (focusOnly: boolean) => async (ctx: SpaceCtx) => {
  const response = await ctx.call(
    "revit.detail.space-scene",
    sceneRequest(ctx.page.ids, focusOnly),
  );
  ctx.setPage(
    { scene: response.id, selected: null, hidden: [], isolated: null, viewport: null, row: null },
    push,
  );
};

/** A read whose answer, with its request, lands on the Page key of the same name. */
const read = <
  K extends OpKey,
  Key extends "status" | "rows" | "tree" | "slice" | "probe" | "sweep",
>(
  op: K,
  key: Key,
  says: string,
  input: z.ZodType<OpRequestOf<K>>,
) => ({
  label: key,
  says,
  needs: "document" as const,
  actor: "any" as const,
  visible: false as const,
  input: input as unknown as z.ZodType<never>,
  dirties: [],
  waitSeconds: NATIVE_READ_WAIT_S,
  ready: () => null,
  run: async (ctx: SpaceCtx, request: OpRequestOf<K>) => {
    const response = await (ctx.call as (k: K, r: OpRequestOf<K>) => Promise<OpResponseOf<K>>)(
      op,
      request,
    );
    ctx.setPage({ [key]: { request, response } } as Partial<SpacePage>);
  },
});

const xyz = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const positive = z.number().finite().positive();

/** The tutorial: what the route is for, controls teach their layers and encodings. */
const docs = (
  <>
    <p>
      What Pe.Revit.Space collects about this document, in host internal feet. Capture the host
      element ids (or Load context for what is around them), then orbit, pick, hide, isolate and
      cut. A pick shows its row: partition, element id, link instance, DWG layer, extrusion reason;
      right click or Selection Box shows it in Revit. Keys 1-4 switch 3D, Top, North and East; Esc
      in an axis returns to the 3D pose you left. Each axis holds one cut, a polyline extruded
      through the scene, and the picture keeps their intersection: drag a node or an edge grip (an
      edge folds along its neighbours and collapses to their corner when pushed past it), right
      click an edge to add a node or a node to delete it.
    </p>
  </>
);

export const manifest = defineRoute<
  never,
  "scene",
  SpacePage,
  | "capture"
  | "context"
  | "status"
  | "rows"
  | "tree"
  | "slice"
  | "probe"
  | "sweep"
  | "hide"
  | "isolate"
  | "showAll"
  | "fit"
>({
  key: "space",
  name: "Space",
  docs,
  needs: "document",
  readings: { scene: () => null },
  page: spacePageSchema,
  address: "space",
  // The contract refuses a viewport of the wrong kind; between two axes both are planes, so a
  // mode-only change fits here (a pose of one axis means nothing in another).
  transition: (current, patch) => ({
    patch:
      Object.hasOwn(patch, "mode") &&
      patch.mode !== current.mode &&
      !Object.hasOwn(patch, "viewport")
        ? { ...patch, viewport: null }
        : patch,
  }),
  actions: {
    capture: {
      label: "capture",
      says: "Capture the named host elements' meshes into a new scene (revit.detail.space-scene)",
      needs: "document",
      input: none,
      dirties: [],
      waitSeconds: NATIVE_READ_WAIT_S,
      ready: (ctx) => (ctx.page.ids.length ? null : "Name host element ids to capture"),
      run: capture(true),
    },
    context: {
      label: "load context",
      says: "Capture the named elements and what is around them (no ids: the whole model, within budget)",
      needs: "document",
      input: none,
      dirties: [],
      waitSeconds: NATIVE_READ_WAIT_S,
      ready: () => null,
      run: capture(false),
    },
    status: read(
      "revit.detail.space-status",
      "status",
      "Read the document epoch and levels without retaining or extracting geometry",
      z.object({}),
    ),
    rows: read(
      "revit.detail.space-rows",
      "rows",
      "Read every PrimRow: partition, category, kind, layer, height role and box",
      z.object({}),
    ),
    tree: read(
      "revit.detail.space-tree",
      "tree",
      "Read one source's BVH nodes down to a depth",
      z.object({
        source: z.number().int().nonnegative(),
        maxDepth: z.number().int().min(1).max(16),
      }),
    ),
    slice: read(
      "revit.detail.space-slice",
      "slice",
      "Slice every triangle to a z band and flatten it into rings",
      z
        .object({ z0: z.number().finite(), z1: z.number().finite() })
        .refine((band) => band.z1 > band.z0, "z1 must be above z0"),
    ),
    probe: read(
      "revit.detail.space-probe",
      "probe",
      "Cast a ray down and up from a point and report what it hits",
      z.object({ at: xyz }),
    ),
    sweep: read(
      "revit.detail.space-sweep",
      "sweep",
      "Sweep a width x height profile along a polyline and ink each segment HIT, NEAR or CLEAR",
      z.object({
        polyline: z.array(xyz).min(2),
        widthFt: positive,
        heightFt: positive,
        clearanceFt: z.number().finite().nonnegative(),
      }),
    ),
    hide: {
      label: "hide",
      says: "Hide the picked element",
      ...local,
      visible: false,
      input: none,
      dirties: [],
      ready: (ctx) => (ctx.page.selected ? null : "Pick an element"),
      run: async (ctx) => {
        const key = ctx.page.selected!;
        ctx.setPage({ hidden: [...new Set([...ctx.page.hidden, key])], selected: null }, push);
      },
    },
    isolate: {
      label: "isolate",
      says: "Show the picked element alone",
      ...local,
      visible: false,
      input: none,
      dirties: [],
      ready: (ctx) => (ctx.page.selected ? null : "Pick an element"),
      run: async (ctx) => {
        const key = ctx.page.selected!;
        ctx.setPage({ isolated: [key], hidden: ctx.page.hidden.filter((k) => k !== key) }, push);
      },
    },
    showAll: {
      label: "show all",
      says: "Clear hidden and isolated",
      ...local,
      visible: false,
      input: none,
      dirties: [],
      ready: (ctx) =>
        ctx.page.hidden.length || ctx.page.isolated !== null ? null : "Everything is shown",
      run: async (ctx) => ctx.setPage({ hidden: [], isolated: null }, push),
    },
    fit: {
      label: "fit",
      says: "Fit the picture to the scene",
      ...local,
      visible: false,
      input: none,
      dirties: [],
      ready: (ctx) => (ctx.page.viewport ? null : "Already fitted"),
      run: async (ctx) => ctx.setPage({ viewport: null }, push),
    },
  },
});
