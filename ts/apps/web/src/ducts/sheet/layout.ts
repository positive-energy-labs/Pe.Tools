/**
 * The fan sheet's workspace anatomy (protoui round 3, 2026-10-28), on the house pane system as
 * the E screen's `DUCTS_LAYOUT`: one full-height sidebar on the left (roster over the inputs
 * fold), and on the right a vertical split, picture over the tier ledger. Sizes are pixels; the
 * picture's 360 px default is about 45 % of an 800 px page and the ledger never folds under
 * 240 px by drag (`minOtherSize`), only by the rail.
 */
import { declaredTeaching, type TeachingLayout } from "@pe/kit/lang/teach";
import { LIST_ACTIONS, LIST_SEARCH_SYNTAX, SEARCH_FOCUS_SYNTAX } from "@pe/kit/lang/list-teaching";
import { actionTeaching } from "@pe/kit/keys";
import { stageTeaching } from "#/scene/stage-teaching";
import { DUCTS_LAYER_OPTIONS } from "../proto/e/teaching";

const listControls = (label: string) => [
  {
    kind: "search" as const,
    label: `Search ${label}`,
    fields: [],
    syntax: [...SEARCH_FOCUS_SYNTAX, ...LIST_SEARCH_SYNTAX],
  },
  { kind: "keys" as const, scope: label, items: actionTeaching(Object.values(LIST_ACTIONS)) },
];
const SHEET_REGIONS = {
  roster: {
    id: "sheet-roster",
    pane: { scroll: "clip", flush: true },
    label: "Fans",
    purpose: "Every fan port on the roster, incomplete first; open one to read its sheet.",
    controls: listControls("fans"),
  },
  inputs: {
    id: "sheet-inputs",
    pane: { scroll: "auto", flush: true },
    label: "Inputs",
    purpose:
      "Every input the sheet reads, by owner: firm (file, not yet), project, this fan, this element. A live field writes; a no-op field says why it cannot.",
    controls: [],
  },
  picture: {
    id: "sheet-picture",
    pane: { scroll: "clip", flush: true, picture: true },
    label: "Picture",
    purpose: "The open fan's walk; every blocker is drawn where it can be drawn and listed below.",
    controls: [
      ...stageTeaching(),
      { kind: "views" as const, label: "layers", options: DUCTS_LAYER_OPTIONS },
    ],
  },
  ledger: {
    id: "sheet-ledger",
    pane: { scroll: "auto", flush: true },
    label: "Ledger",
    purpose: "Required ESP and the open fan's blockers by consent tier, each with its closer.",
    controls: [],
  },
} as const;

export const SHEET_LAYOUT = {
  id: "sheet",
  axis: "horizontal",
  target: "start",
  size: 420,
  minSize: 300,
  maxSize: 760,
  minOtherSize: 480,
  persist: "sheet-sidebar",
  rails: { start: { title: "Fans", collapseBelow: 200 } },
  start: {
    id: "sheet-side",
    axis: "vertical",
    target: "end",
    size: 360,
    minSize: 120,
    minOtherSize: 160,
    persist: "sheet-side-inputs",
    rails: { end: { title: "Inputs", collapseBelow: 80 } },
    start: SHEET_REGIONS.roster,
    end: SHEET_REGIONS.inputs,
  },
  end: {
    id: "sheet-main",
    axis: "vertical",
    target: "start",
    size: 360,
    minSize: 200,
    minOtherSize: 240,
    persist: "sheet-main-picture",
    rails: { start: { title: "Picture", collapseBelow: 120 } },
    start: SHEET_REGIONS.picture,
    end: SHEET_REGIONS.ledger,
  },
} as const satisfies TeachingLayout;
export const SHEET_TEACHING = declaredTeaching(SHEET_LAYOUT);
