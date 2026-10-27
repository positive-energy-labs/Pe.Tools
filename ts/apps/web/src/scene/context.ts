import type { Look } from "./grounds";
import type { Tier } from "./types";
import { CATEGORY_IDS } from "./categories";

const WALLS = new Set<number>([
  CATEGORY_IDS.walls,
  CATEGORY_IDS.curtainPanels,
  CATEGORY_IDS.curtainMullions,
]);
const STRUCTURAL = new Set<number>([
  CATEGORY_IDS.structuralColumns,
  CATEGORY_IDS.structuralFraming,
  CATEGORY_IDS.structuralFoundations,
  CATEGORY_IDS.floors,
]);
const LIGHTING = new Set<number>([CATEGORY_IDS.lightingFixtures, CATEGORY_IDS.lightingDevices]);

/** Subjects and the equipment shell are never filtered. A hidden category hides every context and
 * stub instance. The context presets and lighting toggle hide context and proximity stubs (non-focus
 * MEP), but not a one-hop neighbour stub: the mesh-only view keeps those through any preset. */
export function contextVisible(
  categoryId: number | null,
  tier: Tier,
  layers: Look["layers"],
  neighbour = false,
): boolean {
  if (tier === "subject" || tier === "envelope") return true;
  if (categoryId !== null && layers.hiddenCategories.includes(String(categoryId))) return false;
  if (tier === "stub" && neighbour) return true;
  if (!layers.lighting && categoryId !== null && LIGHTING.has(categoryId)) return false;
  switch (layers.context) {
    case "all":
      return true;
    case "walls":
      return categoryId !== null && WALLS.has(categoryId);
    case "structural":
      return categoryId !== null && STRUCTURAL.has(categoryId);
    case "none":
      return false;
  }
}
