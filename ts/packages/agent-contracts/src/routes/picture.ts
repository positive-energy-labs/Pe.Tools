import { z } from "zod";
import { sceneViewSchema, sceneViewCodec } from "../scene-view.ts";
import {
  fitViewportCodec,
  layersKey,
  modeKey,
  viewportKey,
  viewportSchema,
  type Viewport,
} from "../page-keys.ts";
import { field, text } from "../route-field.ts";

/**
 * The Page keys a route's `Picture` (web `scene/picture`) reads and writes. A route's fields take
 * these by name, in the order its address already has; the layer keys and the default encoding
 * are the route's choice (one line each).
 */
export const pictureFields = <const L extends readonly [string, ...string[]]>(
  layers: L,
  on: readonly L[number][],
  encoding: string,
) => ({
  contextRadiusFt: field(z.number().min(0).max(64).default(10), { url: "replace", agent: "set" }),
  sceneView: field(
    sceneViewSchema.default({ preset: "all", section: null }),
    { url: "replace", agent: "set" },
    sceneViewCodec,
  ),
  /** The selected element id; empty = none. */
  selected: field(text(), { url: "push", agent: "set" }),
  /** The picture's encoding, a key of the web's `ENCODINGS`. */
  encoding: field(z.string().max(200).default(encoding), { url: "push", agent: "set" }),
  /** The layer keys the picture draws; empty = none. */
  layers: field(layersKey(layers, on), { url: "push", agent: "set" }),
  /**
   * How the model picture draws context when the halo or context layer is on: `glass` surfaces or
   * `lines`. With neither layer on, context is off (nothing captured or drawn).
   */
  contextStyle: field(modeKey(["lines", "glass"], "glass"), { url: "replace", agent: "set" }),
  /** What the picture pane draws: the `model` in space, or the `schematic` one-line. */
  picture: field(modeKey(["model", "schematic"], "model"), { url: "push", agent: "set" }),
  /** Where the model picture looks from; null = fit the subject. A drag replaces, a preset pushes. */
  viewport: field(
    viewportKey(viewportSchema),
    { url: "replace", agent: "set" },
    fitViewportCodec<Viewport>(),
  ),
  /**
   * The selected inbox row: an issue id (it may name no element), or `<segment>:<cell key>` for a
   * Work cell; empty = none. Exception to "Pea's, never the URL's": the chat head's review link is
   * an address (`LinkPage` carries URL keys only) and must land on a cell's row. `replace`, so a
   * row pick never fills history; the issue-id half still resets whenever the selection moves.
   */
  issue: field(text(), { url: "replace", agent: "set" }),
});

type PictureFields = ReturnType<typeof pictureFields<[string, ...string[]]>>;
/** The page slice the picture reads and writes, over a route's own layer keys. */
export type PicturePage<L extends string = string> = {
  [K in Exclude<keyof PictureFields, "layers">]: z.output<PictureFields[K]["schema"]>;
} & { layers: L[] };
