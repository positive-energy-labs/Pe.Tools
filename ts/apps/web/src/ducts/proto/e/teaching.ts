import { DUCTS_LAYERS } from "@pe/agent-contracts";
import { declaredTeaching, type TeachingLayout } from "@pe/kit/lang/teach";
import { LIST_ACTIONS, LIST_SEARCH_SYNTAX, SEARCH_FOCUS_SYNTAX } from "@pe/kit/lang/list-teaching";
import { actionTeaching } from "@pe/kit/keys";
import { stageTeaching } from "#/scene/stage-teaching";

const LAYER_WORDS: Record<
  (typeof DUCTS_LAYERS)[number],
  { label: string; chord?: "M" | "C" | "L" }
> = {
  meshes: { label: "meshes", chord: "M" },
  "system-colours": { label: "system colours" },
  "stub-labels": { label: "stub labels" },
  halo: { label: "proximity halo" },
  context: { label: "context", chord: "C" },
  centrelines: { label: "centrelines", chord: "L" },
  "no-run": { label: "branches with no run" },
  labels: { label: "labels" },
  findings: { label: "findings" },
};

export const DUCTS_LAYER_OPTIONS = DUCTS_LAYERS.map((key) => ({ key, ...LAYER_WORDS[key] }));
export const DUCTS_PICTURE_MODES = (["model", "schematic"] as const).map((key) => ({
  key,
  label: key,
  says: `The ${key} large, the other in the corner`,
}));
const search = (label: string) => ({
  kind: "search" as const,
  label: `Search ${label}`,
  fields: [],
  syntax: [...SEARCH_FOCUS_SYNTAX, ...LIST_SEARCH_SYNTAX],
});
const listControls = (label: string) => [
  search(label),
  { kind: "keys" as const, scope: label, items: actionTeaching(Object.values(LIST_ACTIONS)) },
];
export const DUCTS_REGIONS = {
  systems: {
    id: "systems",
    label: "Systems",
    purpose: "Choose a system to inspect its tree and Inputs.",
    controls: listControls("systems"),
  },
  rules: {
    id: "rules",
    label: "All-systems rules",
    purpose:
      "A rule is a fitting type (family : type) plus a geometry condition. Its table is the one choice a person makes; Pe re-looks-up every instance under it. A fitting with a stated drop is an override under its type.",
    controls: listControls("rules"),
  },
  picture: {
    id: "picture",
    label: "Picture",
    purpose: "Inspect the model or schematic; selecting a system changes the scope.",
    controls: [
      ...stageTeaching(),
      { kind: "modes" as const, label: "picture", options: DUCTS_PICTURE_MODES },
      { kind: "views" as const, label: "layers", options: DUCTS_LAYER_OPTIONS },
    ],
  },
  rulings: {
    id: "rulings",
    label: "Rulings",
    purpose: "Review the rows that need a person's ruling before writing changes.",
    controls: listControls("rulings"),
  },
} as const;
/** Reference anatomy, with support panes expanded; current folding and geometry are measured. */
export const DUCTS_LAYOUT = {
  id: "sidebar",
  axis: "horizontal",
  target: "start",
  size: 420,
  start: {
    id: "stack",
    axis: "vertical",
    target: "end",
    size: 176,
    start: DUCTS_REGIONS.systems,
    end: DUCTS_REGIONS.rules,
  },
  end: {
    id: "drawing",
    axis: "horizontal",
    target: "end",
    size: 340,
    start: DUCTS_REGIONS.picture,
    end: DUCTS_REGIONS.rulings,
  },
} as const satisfies TeachingLayout;
export const DUCTS_TEACHING = declaredTeaching(DUCTS_LAYOUT);
