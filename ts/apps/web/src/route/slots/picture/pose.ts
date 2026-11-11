import { picturePoseSchemas } from "@pe/agent-contracts/slots";
import { field } from "../../typed-route.ts";

/**
 * The kernel's picture pose as Page fields (ADR 0035 rule 1). Each default is the contract schema's
 * own (`picturePoseSchemas`): nothing here states one. A picture route spreads `picturePose` into
 * `fields` until slice 10 moves the pose onto the `picture` slot.
 */
export const poseFields = (s: typeof picturePoseSchemas) => ({
  contextRadiusFt: field(s.contextRadiusFt, s.contextRadiusFt.parse(undefined), "pose", "replace"),
  sceneView: field(s.sceneView, s.sceneView.parse(undefined), "pose", "replace"),
  viewport: field(s.viewport, s.viewport.parse(undefined), "pose", "replace"),
  context: field(s.context, s.context.parse(undefined), "pose", "push"),
  layers: field(s.layers, s.layers.parse(undefined), "pose", "push"),
  encoding: field(s.encoding, s.encoding.parse(undefined), "pose", "push"),
  picture: field(s.picture, s.picture.parse(undefined), "pose", "push"),
});
export const picturePose = poseFields(picturePoseSchemas);
