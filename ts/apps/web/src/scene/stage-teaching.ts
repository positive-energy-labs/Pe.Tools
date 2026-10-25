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
} as const satisfies Record<string, Omit<ActionDefinition, "invoke">>;
export const stageTeaching = (): readonly TeachDescriptor[] => [
  {
    kind: "keys",
    scope: "Picture",
    items: [...actionTeaching(Object.values(STAGE_ACTIONS)), ...ORBIT_GESTURES],
  },
];
