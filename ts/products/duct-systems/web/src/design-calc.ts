import { DUCTS_CRITERIA_CELLS, type DuctsCriteriaCell, type DuctsInputs } from "@pe/agent-contracts";
import { store, type CellLayer, type SheetSlot } from "@pe/agent-contracts/slots";
import { ductsSettings, settingLayer, criterionDomain, criterionCellLabel as cellLabel, NO_SHARED_ROOT, ENGINE_DEFAULT_NO_SHARED_ROOT } from "@pe/agent-contracts/setting-owners";
import type { SettingTierRead } from "@pe/agent-contracts/tiered-setting";

type DesignRead = {
  readonly criteria?: DuctsInputs["criteria"];
  readonly firm?: import("@pe/ducts-contract/duct-inputs").DuctFirmLine;
  readonly settings?: Record<string, readonly SettingTierRead[]>;
  readonly network?: { readonly slots: Readonly<Record<string, string | null>>; readonly slotSources?: Readonly<Record<string, { readonly source: CellLayer["source"]; readonly ref?: string; readonly note?: string }>> };
} | null;
/** One Work row per criterion; settings retain the slot and friction save targets. */
export const designCalc = {
  draft: true,
  from: (read: DesignRead) => (read?.firm && "refused" in read.firm ? { says: NO_SHARED_ROOT } : null),
  bindings: {
    ...Object.fromEntries(Object.entries(ductsSettings).filter(([, b]) => b.home.at === "setting" && b.home.path[0] !== "criteria").map(([key, b]) => [key, { ...b, model: (read: DesignRead) => ({
      value: null, ...(b.home.at === "setting" && b.home.path[0] === "parameters" ? { source: "default", ...read?.network?.slotSources?.[b.home.path[1] ?? ""], value: read?.network?.slots[b.home.path[1] ?? ""] ?? null } : settingLayer(b, read?.settings?.ducts)),
    }) }])),
    ...Object.fromEntries((Object.keys(DUCTS_CRITERIA_CELLS) as DuctsCriteriaCell[]).map(cell => [`criteria.${cell}`, store("_PE_DuctLosses", criterionDomain(cell), "route", {
      label: cellLabel(cell),
      model: (read: DesignRead): CellLayer | null => {
        const [key, side] = DUCTS_CRITERIA_CELLS[cell].layer;
        const at = read?.criteria?.[key], resolved = side ? (at as DuctsInputs["criteria"]["velocityLimitFpm"] | undefined)?.[side] : at as DuctsInputs["criteria"]["autoJoinGapIn"] | undefined;
        if (!resolved || resolved.value == null) return null;
        const refused = (resolved.source === "default" || resolved.source === "firm") && read?.firm && "refused" in read.firm;
        return { value: resolved.value, source: refused ? "default" : resolved.source === "Work" || resolved.source === "run" ? "work" : resolved.source,
          ref: refused ? ENGINE_DEFAULT_NO_SHARED_ROOT : resolved.ref ?? undefined, ...(resolved.units ? { unit: resolved.units } : {}) };
      },
    })])),
  },
} as const satisfies SheetSlot;
