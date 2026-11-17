import { DUCTS_CRITERIA_CELLS, type DuctsCriteriaCell } from "@pe/agent-contracts";
import { store, type CellLayer, type SheetSlot } from "@pe/agent-contracts/slots";
import { ductsSettings, criterionDomain, criterionCellLabel as cellLabel, NO_SHARED_ROOT, ENGINE_DEFAULT_NO_SHARED_ROOT } from "@pe/agent-contracts/setting-owners";

/*
 * /ducts' design sheet (ruling 2026-11-10: /ducts owns its design data). One row per criterion cell
 * and the design friction rate; the model layer is the criteria as they stand under Work (the store
 * over the firm file), and a firm-sourced row names the file. Fitting tables, rule assignments, unit
 * kinds and network rulings keep their /ducts panes (Rules, All-systems rules, Rulings): one path each.
 */
type Resolved = { readonly value: unknown; readonly source: string; readonly units: string | null };
type DesignRead = {
  readonly criteria?: Readonly<Record<string, Resolved | Readonly<Record<"supply" | "return", Resolved>>>>;
  readonly firm?: import("@pe/ducts-contract/duct-inputs").DuctFirmLine;
} | null;

const SOURCES: Readonly<Record<string, CellLayer["source"]>> = { "model-store": "model-store", model: "model", project: "project", firm: "firm", default: "default" };
const resolvedOf = (read: DesignRead, cell: DuctsCriteriaCell) => {
  const [key, side] = DUCTS_CRITERIA_CELLS[cell].layer;
  const at = read?.criteria?.[key];
  return (side ? (at as Record<string, Resolved> | undefined)?.[side] : at) as Resolved | undefined;
};
/** The firm line: which file the firm layer is, and whether it is there or the seed stands in for it. */
const firmRef = (firm: Exclude<NonNullable<DesignRead>["firm"], { readonly refused: string }> | undefined) =>
  firm ? `${firm.version} · ${firm.path.split(/[\/]/).at(-1)}${firm.present ? "" : " (missing, on the seed)"}` : undefined;

export const designCalc = {
  draft: true,
  // Slice 2b's banner: with the firm layer refused, the sheet draws the fix once, above its cells.
  from: (read: DesignRead) => (read?.firm && "refused" in read.firm ? { says: NO_SHARED_ROOT } : null),
  bindings: {
    ...ductsSettings,
    ...Object.fromEntries((Object.keys(DUCTS_CRITERIA_CELLS) as DuctsCriteriaCell[]).map(cell => [`criteria.${cell}`, store("_PE_DuctLosses", criterionDomain(cell), "route", {
      label: cellLabel(cell),
      model: (read: DesignRead) => {
        const resolved = resolvedOf(read, cell);
        if (!resolved || resolved.value == null) return null;
        // A criterion no home states is the engine default; with the firm home not found, the row says so.
        // The host never labels a refused firm read "firm"; if a read ever did, this sheet still would not.
        if ((resolved.source === "default" || resolved.source === "firm") && read?.firm && "refused" in read.firm)
          return { value: resolved.value, source: "default", ref: ENGINE_DEFAULT_NO_SHARED_ROOT,
            ...(resolved.units ? { unit: resolved.units } : {}) };
        const source = SOURCES[resolved.source] ?? "model";
        return { value: resolved.value, source, ...(source === "firm" ? { ref: firmRef(read?.firm as Parameters<typeof firmRef>[0]) } : {}),
          ...(resolved.units ? { unit: resolved.units } : {}) };
      },
    })])),
  },
} as const satisfies SheetSlot;
