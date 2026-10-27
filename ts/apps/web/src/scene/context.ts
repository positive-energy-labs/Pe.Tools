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

/** Subjects and the equipment shell are never filtered. Context and stub (non-focus MEP, and the
 * one-hop neighbours) obey the category filters: a category the user hid stays hidden whatever
 * its tier (ruling 2026-10-27; this replaces "presets cannot remove one-hop stubs"). */
export function contextVisible(
  categoryId: number | null,
  tier: Tier,
  layers: Look["layers"],
): boolean {
  if (tier === "subject" || tier === "envelope") return true;
  if (categoryId !== null && layers.hiddenCategories.includes(String(categoryId))) return false;
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
