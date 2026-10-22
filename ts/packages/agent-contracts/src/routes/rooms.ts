import { z } from "zod";
import { layersKey } from "../page-keys.ts";
import { field, text, type RouteAddress } from "../route-field.ts";
import { demo, planViewport } from "./shared.ts";

/** The solver layers the Rooms plan draws, in strip order. */
export const ROOMS_LAYERS = ["rails", "openings", "network", "faces"] as const;

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
    viewport: planViewport,
    demo,
  },
  agent: {
    policy:
      "Change only the viewport of the visible Rooms plan. Use plane:scale,tx,ty in the displayed frame, or an empty viewport to fit. Facts name the displayed document, acquired snapshot and plan. Focus, view, stage, layers and room selection remain the person's. A view change does not partition rooms, stage Work or write Revit.",
  },
} satisfies RouteAddress;
