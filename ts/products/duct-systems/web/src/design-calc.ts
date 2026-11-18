import { DUCTS_CRITERIA_CELLS, slotLayer, type DuctsCriteriaCell, type DuctsInputs } from "@pe/agent-contracts";
import { cellSource, store, type CellLayer, type SheetSlot } from "@pe/agent-contracts/slots";
import { ductsSettings, settingLayer, criterionDomain, criterionCellLabel as cellLabel, NO_SHARED_ROOT, ENGINE_DEFAULT_NO_SHARED_ROOT } from "@pe/agent-contracts/setting-owners";
import type { SettingTierRead } from "@pe/agent-contracts/tiered-setting";

type DesignRead = {
  readonly criteria?: DuctsInputs["criteria"];
  readonly firm?: import("@pe/ducts-contract/duct-inputs").DuctFirmLine;
  readonly settings?: Record<string, readonly SettingTierRead[]>;
  readonly network?: Parameters<typeof slotLayer>[0];
} | null;
/** One Work row per criterion; settings retain the slot and friction save targets. */
export const designCalc = {
  draft: true,
  from: (read: DesignRead) => (read?.firm && "refused" in read.firm ? { says: NO_SHARED_ROOT } : null),
  bindings: {
    ...Object.fromEntries(Object.entries(ductsSettings).filter(([, b]) => b.home.at === "setting" && b.home.path[0] !== "criteria").map(([key, b]) => [key, { ...b, model: (read: DesignRead) => b.home.at === "setting" && b.home.path[0] === "parameters" ? slotLayer(read?.network, b.home.path[1] ?? "") : settingLayer(b, read?.settings?.ducts) }])),
    ...Object.fromEntries((Object.keys(DUCTS_CRITERIA_CELLS) as DuctsCriteriaCell[]).map(cell => [`criteria.${cell}`, store("_PE_DuctLosses", criterionDomain(cell), "route", {
      label: cellLabel(cell),
      model: (read: DesignRead): CellLayer | null => {
        const [key, side] = DUCTS_CRITERIA_CELLS[cell].layer;
        const at = read?.criteria?.[key], resolved = side ? (at as DuctsInputs["criteria"]["velocityLimitFpm"] | undefined)?.[side] : at as DuctsInputs["criteria"]["autoJoinGapIn"] | undefined;
        if (!resolved || resolved.value == null) return null;
        const refused = (resolved.source === "default" || resolved.source === "firm") && read?.firm && "refused" in read.firm;
        return { value: resolved.value, source: refused ? "default" : cellSource(resolved.source),
          ref: refused ? ENGINE_DEFAULT_NO_SHARED_ROOT : resolved.ref ?? undefined, ...(resolved.units ? { unit: resolved.units } : {}) };
      },
    })])),
  },
} as const satisfies SheetSlot;
