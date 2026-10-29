import { actionTeaching, type ActionDefinition } from "@pe/kit/keys";
import type { TeachDescriptor } from "@pe/kit/lang/teach";
import { ORBIT_GESTURES } from "./gestures";
export const STAGE_ACTIONS = {
  frame: {
    id: "stage.frame",
    label: "frame",
    description: "Frame the selection; with nothing selected, fit the picture",
    bindings: ["F"],
  },
  projection: {
    id: "stage.projection",
    label: "perspective or parallel",
    description: "Switch projection, keeping the look-at and framing",
    bindings: ["O"],
  },
  look: {
    id: "stage.look",
    label: "plan or isometric",
    description: "Look down or isometric, keeping pivot and zoom",
    bindings: ["P"],
  },
  north: {
    id: "stage.north",
    label: "look north",
    description: "Look north, keeping elevation, pivot and zoom",
    bindings: ["N"],
  },
  wiggle: {
    id: "stage.wiggle",
    label: "wiggle",
    description:
      "Circle the camera briefly about the target for depth, then return to the same view; any input stops it",
    bindings: ["W"],
  },
} as const satisfies Record<string, Omit<ActionDefinition, "invoke">>;
export const stageTeaching = (): readonly TeachDescriptor[] => [
  {
    kind: "keys",
    scope: "Picture",
    items: [...actionTeaching(Object.values(STAGE_ACTIONS)), ...ORBIT_GESTURES],
  },
];

/** The picture's two modes, the model and a surface's flat picture, as the pane strip and Help
 * teach them; `S` swaps them. */
export const pictureModes = (flat: { key: string; label: string; says?: string }) => [
  { key: "model", label: "model", says: "The model large, the other in the corner" },
  {
    key: flat.key,
    label: flat.label,
    says: flat.says ?? `The ${flat.label} large, the other in the corner`,
  },
];
