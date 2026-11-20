import { z } from "zod";
import { handle } from "./command-handle.ts";

export const writeSettingTier = handle("settings.tiers.write");

/*
 * Tiered settings (ADR 0037 rule 8; homes MAP slice 6b). A setting is one value at `path` inside
 * `Settings/<owner>.json`, and that file may sit in each home. The host reads every tier's file as
 * it stands and says which home it came from. Routes draw the host's resolved inputs, including
 * Work; `serveSetting` resolves home tiers where no more specific input serves the value.
 */

/** The home tiers a setting may declare, most specific first: the first tier that states the value serves it. */
export const SETTING_TIERS = ["user", "project", "firm"] as const;
export type SettingTier = (typeof SETTING_TIERS)[number];

/** Who last wrote a tier's file and when. One stamp per file; the write door sets it. */
export const settingWrittenSchema = z.strictObject({
  by: z.string().min(1),
  at: z.string().min(1),
});

/** One tier's `Settings/<owner>.json` as the host read it. */
export const settingTierSchema = z.strictObject({
  tier: z.enum(SETTING_TIERS),
  /** The home's folder. Null: this machine or model has no such home, and `notFound` says where it looked. */
  home: z.string().nullable(),
  /** The home's name as a person knows it (the folder the humans use). */
  name: z.string().nullable(),
  notFound: z.string().optional(),
  path: z.string().nullable(),
  /** The file's hash, the basis of the next write; null when the home holds no file yet. */
  sha256: z.string().nullable(),
  json: z.unknown().optional(),
  /** The file is there and was not used: unreadable, or not a JSON object. Its bytes are kept. */
  error: z.string().optional(),
});
export type SettingTierRead = z.infer<typeof settingTierSchema>;
export const settingTiersSchema = z.array(settingTierSchema);

const at = (json: unknown, path: readonly string[]) =>
  path.reduce<unknown>(
    (value, key) =>
      value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)[key]
        : undefined,
    json,
  );

/** What served a setting: the tier, its home, and what the sheet says about it. */
export interface ServedSetting<T = unknown> {
  readonly value: T | null;
  /** `default` when no declared tier states a valid value. It is never a tier whose home was not found. */
  readonly tier: SettingTier | "default";
  readonly home: string | null;
  /** The label beside the tier word: the home's name, the writer and the time; or why a tier did not serve. */
  readonly ref?: string;
  /** The less specific tiers this value overrides ("overrides firm 900"). */
  readonly note?: string;
}

/**
 * The first declared tier, most specific first, whose file states a value the schema accepts. A
 * tier whose home was not found states nothing, so it can never be the label: the value falls to
 * the next tier or to `fallback`, and the ref names the home that was not found.
 */
export function serveSetting<T>(
  tiers: readonly SettingTierRead[] | null | undefined,
  declared: readonly SettingTier[],
  path: readonly string[],
  schema: z.ZodType<T>,
  fallback?: T,
): ServedSetting<T> {
  const hits: { read: SettingTierRead; value: T }[] = [];
  const missing: string[] = [];
  for (const tier of SETTING_TIERS) {
    if (!declared.includes(tier)) continue;
    const read = tiers?.find((candidate) => candidate.tier === tier);
    if (!read || read.home === null) {
      missing.push(`${tier} home not found`);
      continue;
    }
    const parsed = schema.safeParse(at(read.json, path));
    if (parsed.success && parsed.data != null) hits.push({ read, value: parsed.data });
  }
  const [served, ...under] = hits;
  if (!served)
    return {
      value: fallback ?? null,
      tier: "default",
      home: null,
      ...(missing.length ? { ref: missing.join(", ") } : {}),
    };
  const stamp = settingWrittenSchema.safeParse(
    (served.read.json as { written?: unknown } | null)?.written,
  );
  return {
    value: served.value,
    tier: served.read.tier,
    home: served.read.home,
    ref: [served.read.name, ...(stamp.success ? [stamp.data.by, stamp.data.at] : [])]
      .filter(Boolean)
      .join(" · "),
    ...(under.length
      ? {
          note: `overrides ${under.map((hit) => `${hit.read.tier} ${JSON.stringify(hit.value)}`).join(", ")}`,
        }
      : {}),
  };
}
