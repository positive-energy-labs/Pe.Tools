import { DUCTS_LAYERS } from "@pe/agent-contracts";
import { declaredTeaching, type TeachingLayout } from "@pe/kit/lang/teach";
import { LIST_ACTIONS, LIST_SEARCH_SYNTAX, SEARCH_FOCUS_SYNTAX } from "@pe/kit/lang/list-teaching";
import { actionTeaching } from "@pe/kit/keys";
import { pictureModes, stageTeaching } from "#/scene/stage-teaching";

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

/** E's flat picture: the schematic one-line (`picture=schematic` on the URL). */
export const DUCTS_FLAT = { key: "schematic", label: "schematic" } as const;
export const DUCTS_LAYER_OPTIONS = DUCTS_LAYERS.map((key) => ({ key, ...LAYER_WORDS[key] }));

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
const DUCTS_REGIONS = {
  systems: {
    id: "e-systems",
    pane: { scroll: "clip", flush: true },
    label: "Systems",
    purpose: "Choose a system to inspect its tree and Inputs.",
    controls: listControls("systems"),
  },
  rules: {
    id: "e-rules-all",
    pane: { scroll: "auto", flush: true },
    label: "All-systems rules",
    purpose:
      "A rule is a fitting type (family : type) plus a geometry condition. Its table is the one choice a person makes; Pe re-looks-up every instance under it. A fitting with a stated drop is an override under its type.",
    controls: listControls("rules"),
  },
  tree: {
    id: "e-sidebar",
    label: "System tree",
    available: "system",
    mount: "tree",
    pane: { scroll: "clip", flush: true, header: false },
    purpose: "Inspect the opened systems, their runs and components.",
    controls: listControls("system tree"),
  },
  inputs: {
    id: "e-inputs",
    label: "Inputs",
    available: "system",
    mount: "system",
    pane: { scroll: "auto", flush: true },
    purpose:
      "Each unit and grille of this system, named, with the cells you can type into. A typed value stages as an override and reprices.",
    controls: listControls("inputs"),
  },
  systemRules: {
    id: "e-rules",
    label: "This system's rules",
    available: "system",
    pane: { scroll: "auto", flush: true },
    purpose: "Review fitting rules for the opened systems.",
    controls: listControls("this system's rules"),
  },
  picture: {
    id: "e-picture",
    pane: { scroll: "clip", flush: true, picture: true },
    label: "Picture",
    purpose: "Inspect the model or schematic; selecting a system changes the scope.",
    controls: [
      ...stageTeaching(),
      { kind: "modes" as const, label: "picture", options: pictureModes(DUCTS_FLAT) },
      { kind: "views" as const, label: "layers", options: DUCTS_LAYER_OPTIONS },
    ],
  },
  rulings: {
    id: "e-inbox",
    pane: { flush: true },
    label: "Rulings",
    purpose: "Review the rows that need a person's ruling before writing changes.",
    controls: listControls("rulings"),
  },
} as const;
/** Complete workspace anatomy. Choices share one runtime scope value; folds stay with PaneSplit. */
export const DUCTS_LAYOUT = {
  id: "sidebar",
  axis: "horizontal",
  target: "start",
  size: 420,
  minSize: 280,
  maxSize: 760,
  minOtherSize: 392,
  persist: "proto-e-sidebar",
  rails: { start: { title: "systems", collapseBelow: 200 } },
  start: {
    id: "stack",
    axis: "vertical",
    target: "end",
    size: 176,
    minSize: 64,
    minOtherSize: 200,
    persist: "proto-e-stack",
    start: {
      id: "scope-upper",
      axis: "horizontal",
      target: "end",
      size: 32,
      minSize: 32,
      choice: "scope",
      rails: { start: { title: "Systems" }, end: { title: "System" } },
      start: DUCTS_REGIONS.systems,
      end: {
        id: "inputs",
        axis: "vertical",
        target: "end",
        size: 220,
        minSize: 100,
        minOtherSize: 100,
        persist: "proto-e-system-inputs",
        available: "system",
        rails: { end: { title: "Inputs", collapseBelow: 80 } },
        start: DUCTS_REGIONS.tree,
        end: DUCTS_REGIONS.inputs,
      },
    },
    end: {
      id: "scope-lower",
      axis: "horizontal",
      target: "end",
      size: 32,
      minSize: 32,
      choice: "scope",
      rails: { start: { title: "All-systems rules" }, end: { title: "This system's rules" } },
      start: DUCTS_REGIONS.rules,
      end: DUCTS_REGIONS.systemRules,
    },
  },
  end: {
    id: "drawing",
    axis: "horizontal",
    target: "end",
    size: 340,
    minSize: 260,
    maxSize: 520,
    minOtherSize: { when: "tight", yes: 240, no: 360 },
    persist: "proto-e-inbox",
    rails: { end: { title: "Rulings", collapseBelow: 200 } },
    start: DUCTS_REGIONS.picture,
    end: DUCTS_REGIONS.rulings,
  },
} as const satisfies TeachingLayout;
export const DUCTS_TEACHING = declaredTeaching(DUCTS_LAYOUT);
export const TIGHT_PX = 700;
/** Existing support policy; resizing/folding resolution remains PaneSplit's machine. */
export function ductsPaneState({
  width,
  inboxOpen,
  treeCollapsed,
  priority,
  toRule,
  edit,
}: {
  width: number;
  inboxOpen: boolean | null;
  treeCollapsed: boolean | null;
  priority: "sidebar" | "inbox";
  toRule: number;
  edit: number;
}) {
  const open = inboxOpen ?? ((width === 0 || width >= 1100) && (toRule > 0 || edit > 0));
  const sidebarWanted = !(treeCollapsed ?? (width > 0 && width < TIGHT_PX));
  const cramped =
    width > 0 &&
    width < DUCTS_LAYOUT.minSize + DUCTS_LAYOUT.end.minSize + DUCTS_LAYOUT.end.minOtherSize.no + 16;
  return {
    sidebarCollapsed: !sidebarWanted || (cramped && open && priority === "inbox"),
    inboxShown: open && !(cramped && sidebarWanted && priority === "sidebar"),
  };
}
