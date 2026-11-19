import { z } from "zod";
import {
  DUCT_PARAMETER_KEYS,
  ductParameterNameSchema,
  DUCTS_CRITERIA_CELLS,
  DUCTS_DEFAULT_CRITERIA,
  type DuctsCriteriaCell,
} from "./duct-inputs.ts";
import { criterionLabel } from "./criterion-words.neutral.ts";
import { setting, type Domain, type SheetBinding } from "@pe/agent-contracts/slots/sheet";
import { defineSettingOwner } from "@pe/agent-contracts/setting-owners";

export const ENGINE_DEFAULT_NO_SHARED_ROOT =
  "Engine default: no firm home, so the /ducts firm file (Settings/ducts.json) is not read";
export const criterionDomain = (cell: DuctsCriteriaCell): Domain =>
  DUCTS_CRITERIA_CELLS[cell].domain;
export const criterionCellLabel = (cell: DuctsCriteriaCell) => {
  const [key, side] = DUCTS_CRITERIA_CELLS[cell].layer;
  return side ? `${criterionLabel(key)} ${side}` : criterionLabel(key);
};
/** No options acquisition is needed for these free names; the six product pickers belong to B3. */
const parameterName: Domain = { kind: "enum", shape: z.string().min(1), choices: [] };
export const ductsSettings: Readonly<Record<string, SheetBinding>> = {
  ...Object.fromEntries(
    Object.entries(DUCTS_CRITERIA_CELLS).map(([cell, declared]) => {
      const [key, side] = declared.layer;
      const base = DUCTS_DEFAULT_CRITERIA[key];
      return [
        `setting.ducts.${cell}`,
        setting("ducts", ["criteria", ...declared.layer], declared.domain, ["project", "firm"], {
          label: side ? `${criterionLabel(key)} ${side}` : criterionLabel(key),
          default: side && typeof base === "object" ? base[side] : base,
        }),
      ];
    }),
  ),
  ...Object.fromEntries(
    DUCT_PARAMETER_KEYS.map((key) => [
      `setting.ducts.parameters.${key}`,
      setting(
        "ducts",
        ["parameters", key],
        { ...parameterName, shape: ductParameterNameSchema(key) },
        ["project", "firm"],
        {
          label: key === "requiredEsp" ? "requiredEsp slot (empty writes nowhere)" : `${key} slot`,
        },
      ),
    ]),
  ),
  "setting.ducts.designFriction": setting(
    "ducts",
    ["designFriction"],
    { kind: "number", exclusiveMin: 0, unit: "in-wg/100 ft", digits: 3 },
    ["project", "firm"],
    { label: "Design friction", default: 0.08 },
  ),
};

export const ductsSettingOwner = defineSettingOwner(ductsSettings);
