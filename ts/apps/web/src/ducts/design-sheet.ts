import { z } from "zod";
import { DUCTS_CRITERIA_CELLS, type DuctsCriteriaCell } from "@pe/agent-contracts";
import { local, store, type CellLayer, type SheetSlot } from "@pe/agent-contracts/slots";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { criterionLabel } from "./sheet/criterion-words.neutral.ts";

/*
 * /ducts' design sheet (ruling 2026-11-10: /ducts owns its design data). One row per criterion cell
 * and the design friction rate; the model layer is the criteria as they stand under Work (the store
 * over the firm file), and a firm-sourced row names the file. Fitting tables, rule assignments, unit
 * kinds and network rulings keep their /ducts panes (Rules, All-systems rules, Rulings): one path each.
 */
type Resolved = { readonly value: unknown; readonly source: string; readonly units: string | null };
type DesignRead = {
  readonly criteria?: Readonly<Record<string, Resolved | Readonly<Record<"supply" | "return", Resolved>>>>;
  readonly firm?: { readonly version: string; readonly path: string; readonly present: boolean };
} | null;

const SOURCES: Readonly<Record<string, CellLayer["source"]>> = { "model-store": "model-store", model: "model", firm: "firm", default: "default" };
const resolvedOf = (read: DesignRead, cell: DuctsCriteriaCell) => {
  const [key, side] = DUCTS_CRITERIA_CELLS[cell].layer;
  const at = read?.criteria?.[key];
  return (side ? (at as Record<string, Resolved> | undefined)?.[side] : at) as Resolved | undefined;
};
/** The firm line: which file the firm layer is, and whether it is there or the seed stands in for it. */
export const firmRef = (firm: NonNullable<DesignRead>["firm"]) =>
  firm ? `${firm.version} · ${firm.path.split(/[\/]/).at(-1)}${firm.present ? "" : " (missing, on the seed)"}` : undefined;

export const designSheet = {
  draft: true,
  bindings: {
    criteria: store("_PE_DuctLosses", DUCTS_CRITERIA_CELLS.velocitySupplyFpm.value.or(DUCTS_CRITERIA_CELLS.splitPolicy.value), "subject", {
      min: 0,
      rows: () => Object.keys(DUCTS_CRITERIA_CELLS),
      rowLabel: (_read, row) => {
        const [key, side] = DUCTS_CRITERIA_CELLS[row as DuctsCriteriaCell].layer;
        return side ? `${criterionLabel(key)} ${side}` : criterionLabel(key);
      },
      model: (read: DesignRead, row) => {
        const resolved = resolvedOf(read, row as DuctsCriteriaCell);
        if (!resolved || resolved.value == null) return null;
        const source = SOURCES[resolved.source] ?? "model";
        return { value: resolved.value, source, ...(source === "firm" ? { ref: firmRef(read?.firm) } : {}),
          ...(resolved.units ? { unit: resolved.units } : {}) };
      },
      choices: (_read, row) => row === "splitPolicy"
        ? [{ key: "even", label: "even", value: "even" }, { key: "proportional", label: "proportional", value: "proportional" }]
        : [],
    }),
    designFriction: local(z.number().positive(), "route", {
      label: "Design friction", default: DEFAULT_DESIGN_FRICTION_RATE, unit: "in-wg/100 ft", min: 0, digits: 3,
    }),
  },
} as const satisfies SheetSlot;
