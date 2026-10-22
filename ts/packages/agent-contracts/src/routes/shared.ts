import {
  fitViewportCodec,
  planeViewportSchema,
  viewportKey,
  type PlaneViewport,
} from "../page-keys.ts";
import { field, text } from "../route-field.ts";

/** `?demo=<action>` mounts one seed in an isolated owner: a link's word, never Pea's. */
export const demo = field(text(), { url: "replace" });

/** A plan picture's pan and zoom; null = fit. A drag replaces; Pea may set it. */
export const planViewport = field(
  viewportKey(planeViewportSchema),
  { url: "replace", agent: "set" },
  fitViewportCodec<PlaneViewport>(),
);
