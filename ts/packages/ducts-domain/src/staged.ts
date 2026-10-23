/** What the Work has staged for a write, counted from the document alone. */
import type { DuctsRouteDocument } from "@pe/agent-contracts";

import { pendingRulings } from "./rulings.ts";
import type { DuctSnapshot } from "./types.ts";

/**
 * The segments `ducts.apply` writes to elements and the store; `loads` stays in Pe, and the rulings
 * (`assumptions` verdicts, `roles`) are written to the store as deltas (`pendingRulings`).
 */
export const WRITTEN = [
  "rules",
  "terminalDrops",
  "componentDrops",
  "flows",
  "esp",
  "equipmentFlows",
  "parameters",
] as const;

export const stagedCells = (doc: DuctsRouteDocument | null) =>
  ([...WRITTEN, "catalogs", "ruleAssignments"] as const).flatMap((segment) =>
    Object.entries(doc?.[segment] ?? {}).flatMap(([key, cell]) =>
      cell?.staged ? [{ segment, key, cell }] : [],
    ),
  );

/** How many changes a write would carry: staged cells, and rulings that differ from the store's. */
export const pendingCount = (doc: DuctsRouteDocument | null, store: DuctSnapshot["store"]) =>
  stagedCells(doc).length + pendingRulings(doc, store).length;

/** Staged ESP cells: the one write that waits for a clean calc. */
export const stagedEsp = (doc: DuctsRouteDocument | null) =>
  Object.values(doc?.esp ?? {}).filter((cell) => cell?.staged).length;
