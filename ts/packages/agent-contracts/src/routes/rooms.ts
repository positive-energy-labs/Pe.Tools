import { z } from "zod";
import { layersKey } from "../page-keys.ts";
import { field, text, type RouteDeclaration } from "../route-field.ts";
import { planViewport } from "./shared.ts";

/** The solver layers the Rooms plan draws, in strip order. */
export const ROOMS_LAYERS = ["rails", "openings", "network", "faces"] as const;

/** The review inbox's state filter: every card, or one state's (the web card states). */
const ROOMS_CARD_SHOWS = [
  "all",
  "proposed",
  "fail",
  "stale",
  "gone",
  "accepted",
  "pass",
  "note",
] as const;

export const roomsAddress = {
  path: "/rooms",
  title: "Rooms",
  fields: {
    stage: field(z.enum(["partition", "review", "history"]).default("partition"), {
      url: "push",
    }),
    /** The plan view partition runs on; empty = none chosen. */
    view: field(text(), { url: "push" }),
    /** Solver layers drawn on the plan (`rails,openings`); empty = none. */
    layers: field(layersKey(ROOMS_LAYERS, []), { url: "push" }),
    /** Region labels (`R12,R3`): selected and zoomed to once drawn. */
    focus: field(text(1024), { url: "replace" }),
    /** The review inbox's state filter. */
    show: field(z.enum(ROOMS_CARD_SHOWS).default("all"), { url: "replace" }),
    /** The pinned inbox card (a mark or note id): its verbs are pressable and the plan projects it. */
    card: field(text(), { url: "replace" }),
    viewport: planViewport,
  },
  agent: {
    policy:
      "Change only the viewport of the visible Rooms plan. Use plane:scale,tx,ty in the displayed frame, or an empty viewport to fit. Facts name the displayed document, acquired snapshot and plan. Focus, view, stage, layers, inbox filter, pinned card and room selection remain the person's. A view change does not partition rooms, stage Work or write Revit.",
  },
} satisfies RouteDeclaration;
