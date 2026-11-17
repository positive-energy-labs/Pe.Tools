import { z } from "zod";
import { DUCT_PARAMETER_KEYS, ductParameterNameSchema, DUCTS_CRITERIA_CELLS, DUCTS_DEFAULT_CRITERIA, type DuctsCriteriaCell } from "@pe/ducts-contract/duct-inputs";
import { criterionLabel } from "@pe/ducts-contract/criterion-words.neutral";
import { setting, schemaOf, type Domain, type Home, type SheetBinding } from "./slots/sheet.ts";
import type { SettingTier } from "./tiered-setting.ts";

export const NO_SHARED_ROOT = "No firm home: no shared drive on this machine holds 04 PE Software Files\\Pe.Tools, so the firm files (Settings/<owner>.json) are not read";
export const ENGINE_DEFAULT_NO_SHARED_ROOT = "Engine default: no firm home, so the /ducts firm file (Settings/ducts.json) is not read";
export const criterionDomain = (cell: DuctsCriteriaCell): Domain => DUCTS_CRITERIA_CELLS[cell].domain;
export const criterionCellLabel = (cell: DuctsCriteriaCell) => {
  const [key, side] = DUCTS_CRITERIA_CELLS[cell].layer;
  return side ? `${criterionLabel(key)} ${side}` : criterionLabel(key);
};
/** No options acquisition is needed for these free names; the six product pickers belong to B3. */
const parameterName: Domain = { kind: "enum", shape: z.string().min(1), choices: [] };
export const ductsSettings: Readonly<Record<string, SheetBinding>> = {
  ...Object.fromEntries(Object.entries(DUCTS_CRITERIA_CELLS).map(([cell, declared]) => {
    const [key, side] = declared.layer;
    const base = DUCTS_DEFAULT_CRITERIA[key];
    return [`setting.ducts.${cell}`, setting("ducts", ["criteria", ...declared.layer], declared.domain, ["project", "firm"], {
      label: side ? `${criterionLabel(key)} ${side}` : criterionLabel(key), default: side && typeof base === "object" ? base[side] : base,
    })];
  })),
  ...Object.fromEntries(DUCT_PARAMETER_KEYS.map(key => [`setting.ducts.parameters.${key}`, setting("ducts", ["parameters", key], { ...parameterName, shape: ductParameterNameSchema(key) }, ["project", "firm"], { label: key === "requiredEsp" ? "requiredEsp slot (empty writes nowhere)" : `${key} slot` })])),
  "setting.ducts.designFriction": setting("ducts", ["designFriction"], { kind: "number", exclusiveMin: 0, unit: "in-wg/100 ft", digits: 3 }, ["project", "firm"], { label: "Design friction", default: 0.08 }),
};
export type SettingDeclaration = { name: string; label: string; default: unknown; domain: Domain; home: Extract<Home, { at: "setting" }> };
export type SettingOwner = {
  readonly bindings: readonly SettingDeclaration[];
  at(path: readonly string[]): SettingDeclaration | null;
  accepts(path: readonly string[], value: unknown, tier: SettingTier): boolean;
};
const owner = (bindings: Readonly<Record<string, SheetBinding>>): SettingOwner => {
  const declared = Object.entries(bindings).flatMap(([name, b]) => b.home.at === "setting"
    ? [{ name, label: b.label ?? name, default: b.default, domain: b.domain, home: b.home }] : []);
  const at = (path: readonly string[]) => declared.find(b => b.home.path.length === path.length && b.home.path.every((key, i) => key === path[i])) ?? null;
  return { bindings: declared, at, accepts(path, value, tier) {
    const b = at(path);
    return !!b && b.home.tiers.includes(tier) && (value === null || schemaOf(b.domain).safeParse(value).success);
  } };
};
export const settingOwners: Readonly<Record<string, SettingOwner>> = Object.freeze({ ducts: owner(ductsSettings) });
