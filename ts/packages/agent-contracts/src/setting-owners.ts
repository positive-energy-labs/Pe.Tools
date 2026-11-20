import { schemaOf, type Domain, type Placement, type SheetBinding } from "./slots/sheet.ts";
import { type SettingTier } from "./tiered-setting.ts";
export { settingLayer } from "./slots/sheet.ts";

export const NO_SHARED_ROOT =
  "No firm home, so the firm files (Settings/<owner>.json) are not read. Set your firm home in Settings";
export type SettingDeclaration = {
  name: string;
  label: string;
  default: unknown;
  domain: Domain;
  home: Extract<Placement, { at: "setting" }>;
};
export type SettingOwner = {
  readonly bindings: readonly SettingDeclaration[];
  at(path: readonly string[]): SettingDeclaration | null;
  accepts(path: readonly string[], value: unknown, tier: SettingTier): boolean;
};
export function defineSettingOwners(
  bindings: Readonly<Record<string, Pick<SheetBinding, "home" | "domain" | "label" | "default">>>,
) {
  const groups = new Map<string, SettingDeclaration[]>();
  for (const [name, { home, domain, label, default: fallback }] of Object.entries(bindings)) {
    if (home.at !== "setting") continue;
    const group = groups.get(home.owner) ?? [];
    group.push({ name, label: label ?? name, default: fallback, domain, home });
    groups.set(home.owner, group);
  }
  return Object.fromEntries(
    [...groups].map(([owner, bindings]) => [owner, settingOwner(bindings)]),
  );
}

function settingOwner(declared: readonly SettingDeclaration[]): SettingOwner {
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
}
