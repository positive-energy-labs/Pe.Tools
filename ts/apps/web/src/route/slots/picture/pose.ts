import { picturePoseSchemas as s } from "@pe/agent-contracts/slots";
import { field } from "../../typed-route.ts";

/** The kernel's picture pose as Page fields (ADR 0035 rule 1). A picture route spreads it into `fields` until slice 10 moves the pose onto the `picture` slot. */
export const picturePose = {
  contextRadiusFt: field(s.contextRadiusFt, 10, "pose", "replace"),
  sceneView: field(s.sceneView, { preset: "all", section: null }, "pose", "replace"),
  viewport: field(s.viewport, null, "pose", "replace"),
  context: field(s.context, "glass", "pose", "push"),
  layers: field(s.layers, "default", "pose", "push"),
  encoding: field(s.encoding, "", "pose", "push"),
  picture: field(s.picture, "model", "pose", "push"),
};
