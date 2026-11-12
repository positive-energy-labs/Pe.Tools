import { z } from "zod";
import { DUCT_PARAMETER_KEYS, DUCTS_CRITERIA_CELLS, DUCTS_DEFAULT_CRITERIA, type DuctsCriteriaCell } from "@pe/agent-contracts";
import { setting, store, type CellLayer, type SheetBinding, type SheetSlot } from "@pe/agent-contracts/slots";
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
  readonly firm?: { readonly version: string; readonly path: string; readonly present: boolean } | { readonly refused: "no-shared-root" };
} | null;

/** The firm files, one per owner, live only in the firm home (ADR 0037). The host's own refusals name every place it looked. */
export const NO_SHARED_ROOT = "No firm home: no shared drive on this machine holds 04 PE Software Files\\Pe.Tools, so the firm files (Settings/<owner>.json) are not read";
/** A criterion's provenance when the firm layer is refused: the host resolved it on the engine seed. */
export const ENGINE_DEFAULT_NO_SHARED_ROOT = "Engine default: no firm home, so the /ducts firm file (Settings/ducts.json) is not read";

const SOURCES: Readonly<Record<string, CellLayer["source"]>> = { "model-store": "model-store", model: "model", project: "project", firm: "firm", default: "default" };
const cellLabel = (cell: DuctsCriteriaCell) => {
  const [key, side] = DUCTS_CRITERIA_CELLS[cell].layer;
  return side ? `${criterionLabel(key)} ${side}` : criterionLabel(key);
};
/**
 * The ducts criteria as tiered settings (ADR 0037 rule 8): `criteria.<...>` in `Settings/ducts.json`
 * of the project home, then the firm home. They decide a computed result, so no user tier is
 * declared (ADR 0026: two engineers price the same thing the same way). /fans, /ducts and /settings
 * draw the same bindings, so one value has one label everywhere.
 */
const criteriaSettings = Object.fromEntries(
  (Object.keys(DUCTS_CRITERIA_CELLS) as DuctsCriteriaCell[]).map((cell) => {
    const declared = DUCTS_CRITERIA_CELLS[cell];
    const [key, side] = declared.layer;
    const base = DUCTS_DEFAULT_CRITERIA[key];
    const fallback = side ? (base as Record<string, number>)[side] : base;
    return [`setting.ducts.${cell}`, setting("ducts", ["criteria", ...declared.layer], declared.value, ["project", "firm"], {
      default: fallback, label: cellLabel(cell), ...(declared.unit ? { unit: declared.unit } : {}), ...(cell === "splitPolicy" ? {} : { min: 0 }),
    })];
  }),
) as Readonly<Record<string, SheetBinding>>;
export const ductsSettings = {
  ...criteriaSettings,
  ...Object.fromEntries(DUCT_PARAMETER_KEYS.map(key => [`setting.ducts.parameters.${key}`, setting("ducts", ["parameters", key], z.string().min(1), ["project", "firm"], { label: `${key} slot` })])),
  "setting.ducts.designFriction": setting("ducts", ["designFriction"], z.number().positive(), ["project", "firm"], {
    label: "Design friction", default: DEFAULT_DESIGN_FRICTION_RATE, unit: "in-wg/100 ft", min: 0, digits: 3,
  }),
};
const resolvedOf = (read: DesignRead, cell: DuctsCriteriaCell) => {
  const [key, side] = DUCTS_CRITERIA_CELLS[cell].layer;
  const at = read?.criteria?.[key];
  return (side ? (at as Record<string, Resolved> | undefined)?.[side] : at) as Resolved | undefined;
};
/** The firm line: which file the firm layer is, and whether it is there or the seed stands in for it. */
const firmRef = (firm: Exclude<NonNullable<DesignRead>["firm"], { readonly refused: string }> | undefined) =>
  firm ? `${firm.version} · ${firm.path.split(/[\/]/).at(-1)}${firm.present ? "" : " (missing, on the seed)"}` : undefined;

export const designSheet = {
  draft: true,
  // Slice 2b's banner: with the firm layer refused, the sheet draws the fix once, above its cells.
  from: (read: DesignRead) => (read?.firm && "refused" in read.firm ? { says: NO_SHARED_ROOT } : null),
  bindings: {
    ...ductsSettings,
    criteria: store("_PE_DuctLosses", DUCTS_CRITERIA_CELLS.velocitySupplyFpm.value.or(DUCTS_CRITERIA_CELLS.splitPolicy.value), "subject", {
      min: 0,
      rows: () => Object.keys(DUCTS_CRITERIA_CELLS),
      rowLabel: (_read, row) => cellLabel(row as DuctsCriteriaCell),
      model: (read: DesignRead, row) => {
        const resolved = resolvedOf(read, row as DuctsCriteriaCell);
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
      choices: (_read, row) => row === "splitPolicy"
        ? [{ key: "even", label: "even", value: "even" }, { key: "proportional", label: "proportional", value: "proportional" }]
        : [],
    }),
  },
} as const satisfies SheetSlot;
