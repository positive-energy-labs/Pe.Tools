import type { HandleCellProps } from "@pe/kit/lang/cell";
import { settingOwners } from "@pe/agent-contracts/setting-owners";
import type { Immutable } from "@pe/agent-contracts";
import { serveSetting, SETTING_TIERS, type SettingTierRead } from "@pe/agent-contracts/tiered-setting";
import { schemaOf, type Domain, type ModelValue, type SheetSlot, type StateCell } from "@pe/agent-contracts/slots";
export interface SheetInput<W = unknown> {
  readonly rows: readonly string[];
  readonly work: Immutable<W> | null;
  readonly model: readonly ModelValue[];
  readonly read?: unknown;
}
export interface SheetCell extends StateCell {
  readonly domain: Domain;
  readonly label: string;
  readonly unit?: string;
  readonly numeric?: { min?: number; max?: number; digits?: number };
  readonly field?: string;
  readonly choices?: HandleCellProps["options"];
  readonly ref?: string;
  readonly refusal?: string;
  readonly note?: string;
  readonly setting?: {
    readonly owner: string;
    readonly path: readonly string[];
    readonly tiers: readonly { tier: import("@pe/agent-contracts/tiered-setting").SettingTier; home: string | null; sha256: string | null; notFound?: string }[];
  };
}
/** A dotted binding names its existing nested Work cell, without a second writable copy. */
export const bindingPath = (binding: string, row?: string): [string, ...string[]] => {
  const [first = binding, ...rest] = binding.split(".");
  return [first, ...rest, ...(row === undefined ? [] : [row])];
};
export function domainDraw(domain: Domain, read: unknown, row?: string): Pick<SheetCell, "unit" | "numeric" | "field" | "choices"> {
  if (domain.kind === "number") return { unit: domain.unit, numeric: { min: domain.min ?? domain.exclusiveMin, max: domain.max, digits: domain.digits } };
  if (domain.kind === "enum") {
    const choices = typeof domain.choices === "function" ? domain.choices(read, row) : domain.choices;
    return choices.length ? { choices: choices.map(c => ({ ...c, key: typeof c.value === "string" ? c.value : JSON.stringify(c.value), ...(c.value === null ? { clear: true } : {}) })) } : {};
  }
  if (domain.kind === "object") {
    const fields = Object.entries(domain.fields);
    if (fields.length !== 1) return {};
    const first = fields[0];
    if (!first) return {};
    const [field, child] = first;
    const draw = domainDraw(child, read, row);
    return { ...draw, field, ...(draw.choices ? { choices: draw.choices.map(c => ({ ...c, value: { [field]: c.value ?? c.key } })) } : {}) };
  }
  return {};
}
export function sheetCells(slot: SheetSlot, input: SheetInput): readonly SheetCell[] {
  const read = input.read;
  return Object.entries(slot.bindings).flatMap(([binding, b]) =>
    (b.per === "subject" ? (read !== undefined && b.rows?.(read)) || input.rows : [undefined]).map(row => {
      const home = b.home;
      const tiers = home.at === "setting" ? (read as { settings?: Record<string, readonly SettingTierRead[]> } | undefined)?.settings?.[home.owner] : undefined;
      const served = home.at === "setting" ? serveSetting(tiers, home.tiers, home.path, schemaOf(b.domain), b.default) : null;
      const held = bindingPath(binding, row).reduce<any>((doc, key) => doc?.[key], input.work);
      const edit = slot.draft ? held?.edit : undefined;
      const staged = home.at === "setting" ? undefined : slot.draft ? edit?.value : held;
      const layer = served ? { value: served.value, source: served.tier, ref: served.ref, note: served.note }
        : input.model.find(m => m.binding === binding && m.row === row) ?? (read !== undefined ? b.model?.(read, row) : undefined);
      const model = layer?.value ?? null;
      const value = staged ?? model ?? b.default ?? null;
      return {
        binding, ...(row === undefined ? {} : { row }), home, domain: b.domain,
        value, model, pending: edit && staged !== undefined ? { by: edit.by === "pea" ? "pea" as const : "human" as const, value: staged, at: edit.at ?? "" } : null,
        drift: home.at !== "local" && home.at !== "setting" && JSON.stringify(value) !== JSON.stringify(model),
        freshness: home.at === "setting" ? tiers ? "fresh" : "never" : layer && "freshness" in layer ? layer.freshness ?? "fresh" : layer || home.at === "local" ? "fresh" : "never",
        source: staged !== undefined ? "work" : layer && layer.value != null ? ("source" in layer && layer.source) || "model" : b.default !== undefined ? "default" : "model",
        label: (row !== undefined && read !== undefined && b.rowLabel?.(read, row)) || b.label || binding,
        ...domainDraw(b.domain, read, row),
        ...(layer && "unit" in layer && layer.unit ? { unit: layer.unit } : {}),
        ...(layer && "ref" in layer ? { ref: layer.ref } : {}),
        ...(layer && "note" in layer ? { note: layer.note } : {}),
        ...(layer && "refusal" in layer ? { refusal: layer.refusal } : {}),
        ...(home.at === "setting" ? { setting: { owner: home.owner, path: home.path, tiers: home.tiers.map(tier => {
          const at = tiers?.find(candidate => candidate.tier === tier);
          return { tier, home: at?.home ?? null, sha256: at?.sha256 ?? null, ...(at?.home ? {} : { notFound: at?.notFound ?? `No ${tier} home was read` }) };
        }) } } : {}),
      } satisfies SheetCell;
    }));
}
export const typedCells = (cells: readonly SheetCell[]) => cells.filter(c => c.source === "work");

/** Settings use the same structural kit handle; the mount owns custody and command transport. */
export function homeHandle(path: readonly string[], read: unknown, send: (request: {
  owner: string; tier: import("@pe/agent-contracts/tiered-setting").SettingTier; path: string[]; value: unknown; expectedSha256: string | null;
}) => Promise<void>) {
  const [, owner = "", tierName, ...settingPath] = path;
  const tier = SETTING_TIERS.find(t => t === tierName);
  const registry = Object.hasOwn(settingOwners, owner) ? settingOwners[owner] : undefined;
  const declared = registry?.at(settingPath);
  const at = (read as { settings?: Record<string, readonly SettingTierRead[]> } | undefined)?.settings?.[owner]?.find(at => at.tier === tier);
  const save = async (value: unknown) => {
    if (!registry || !tier || !declared || !registry.accepts(settingPath, value, tier)) return { code: "invalid", message: "No declared setting accepts this value at that tier" };
    if (!at?.home) return { code: "unavailable", message: at?.notFound ?? `No ${tier} home was read` };
    try {
      await send({ owner, tier, path: settingPath, value, expectedSha256: at.sha256 });
      return null;
    } catch (error) { return { code: "refused", message: error instanceof Error ? error.message : String(error) }; }
  };
  return { owner: { route: owner, label: `${tier} home` }, value: {}, facts: {}, freshness: "current" as const,
    refusal: declared ? null : "No declared setting", stage: save, clear: () => save(null),
    accept: async () => null, deny: () => save(null), undo: async () => ({ code: "no-undo", message: "Use the Timeline" }),
    delete: () => save(null), transitions: () => [] };
}
