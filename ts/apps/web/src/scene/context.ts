import type { Look } from "./grounds";
import type { Tier } from "./types";

// PSC1 currently carries Revit display names, not stable BuiltInCategory IDs.
// Unknown names remain visible in "all" and are excluded from positive presets.
const WALLS = new Set(["Walls", "Curtain Panels", "Curtain Wall Mullions"]);
const STRUCTURAL = new Set([
  "Structural Columns",
  "Structural Framing",
  "Structural Foundations",
  "Floors",
]);
const LIGHTING = new Set(["Lighting Fixtures", "Lighting Devices"]);

/** Context presets cannot remove an opened system or its one-hop stubs. */
export function contextVisible(category: string, tier: Tier, layers: Look["layers"]): boolean {
  if (tier !== "context") return true;
  if (layers.hiddenCategories.includes(category)) return false;
  if (!layers.lighting && LIGHTING.has(category)) return false;
  switch (layers.context) {
    case "all":
      return true;
    case "walls":
      return WALLS.has(category);
    case "structural":
      return STRUCTURAL.has(category);
    case "none":
      return false;
  }
}
