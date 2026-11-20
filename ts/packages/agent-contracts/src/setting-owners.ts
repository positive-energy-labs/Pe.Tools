import { schemaOf, type Domain, type Home, type SheetBinding } from "./slots/sheet.ts";
import { type SettingTier } from "./tiered-setting.ts";
export { settingLayer } from "./slots/sheet.ts";

export const NO_SHARED_ROOT =
  "No firm home, so the firm files (Settings/<owner>.json) are not read. Set your firm home in Settings";
export type SettingDeclaration = {
  name: string;
  label: string;
  default: unknown;
  domain: Domain;
  home: Extract<Home, { at: "setting" }>;
};
export type SettingOwner = {
  readonly bindings: readonly SettingDeclaration[];
  at(path: readonly string[]): SettingDeclaration | null;
  accepts(path: readonly string[], value: unknown, tier: SettingTier): boolean;
};
export const defineSettingOwner = (
  bindings: Readonly<Record<string, SheetBinding>>,
): SettingOwner => {
  const declared = Object.entries(bindings).flatMap(([name, b]) =>
    b.home.at === "setting"
      ? [{ name, label: b.label ?? name, default: b.default, domain: b.domain, home: b.home }]
      : [],
  );
  const at = (path: readonly string[]) =>
    declared.find(
      (b) => b.home.path.length === path.length && b.home.path.every((key, i) => key === path[i]),
    ) ?? null;
  return {
    bindings: declared,
    at,
    accepts(path, value, tier) {
      const b = at(path);
      return (
        !!b &&
        b.home.tiers.includes(tier) &&
        (value === null || schemaOf(b.domain).safeParse(value).success)
      );
    },
  };
};
