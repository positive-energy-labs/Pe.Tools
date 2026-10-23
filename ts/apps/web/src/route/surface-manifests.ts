import { z } from "zod";
import { defineRoute } from "./manifest";
import { routeAddress } from "@pe/agent-contracts";
import { SHEET_ROWS, solve } from "#/grilles/math";

export const ductLossManifest = defineRoute({
  key: "duct-loss",
  name: "Duct Loss",
  // The formula's provenance lives here, the route's tutorial (I6), not under the formula.
  docs: "Calculate duct friction from dimensions and airflow. The wheel, charts and formula use the same inputs. All calculation runs in this browser. The formula is ASHRAE Fundamentals, Duct Design: Darcy friction with the Altshul-Tsal factor (L in ft, D in inches, roughness in ft, density in lb/ft3). The wheel reads the friction-chart power law 0.109136·Q^1.9/D^5.02 for galvanized duct and standard air, as the SMACNA Ductulator does; it runs up to a tenth above the Altshul-Tsal figure.",
  address: "duct-loss",
  page: routeAddress("duct-loss").schema,
});

const grilleInput = z
  .object({
    boardLength: z.number(),
    endBorder: z.number(),
    boardWidth: z.number(),
    edgeBorder: z.number(),
    opening: z.number(),
    rib: z.number(),
    openings: z.number(),
    id: z.string(),
  })
  .transform(({ id, ...input }) => ({ ...solve(input), id }));

export const grillesManifest = defineRoute({
  key: "grilles",
  name: "Grilles",
  docs: "Edit candidate wood floor grille profiles. The drawing changes shared dimensions, the chart selects a buildable profile, and checked rows form the printable export. Edits stay in this page.",
  address: "grilles",
  // The address's keys (the active row, the sheet) plus the page-only edits the URL never carries.
  page: routeAddress("grilles").schema.extend({
    rows: z
      .array(grilleInput)
      .default(() => SHEET_ROWS.map((input, i) => ({ ...solve(input), id: `row${i + 7}` }))),
    picked: z.array(z.string()).default(["row7"]),
    drawingCollapsed: z.boolean().default(false),
    project: z.string().default(""),
  }),
});

export const settingsManifest = defineRoute({
  key: "settings",
  name: "Settings",
  docs: "This machine and this app: Revit, Update, Share, Pea providers, Host, notifications, and appearance. Each group states its critical state while folded; repair and configuration live in the group.",
});

export const savedTakeoffsManifest = defineRoute({
  key: "takeoffs-saved",
  name: "Takeoffs saved review",
  docs: "Review an explicit saved takeoff capture. The capture retains its original document and provenance; switching to live chooses a new source.",
  page: z.object({ work: z.string().optional() }),
  readings: {
    capture: (page: { work?: string }) =>
      page.work ? { kind: "takeoff-saved" as const, id: page.work } : null,
    captures: { kind: "takeoff-saved" },
  },
});
