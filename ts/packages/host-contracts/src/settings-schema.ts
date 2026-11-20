/**
 * The library path a `$schema` names: `/schemas/settings/<library>/<root>.json` (C# `SettingsSchemaUrl.Path`),
 * or null when it names no settings library. The path is the member's only identity claim and the only
 * stored form (homes freeze shape 6). Any origin, drive or share in front of it is read through, so a
 * file written before the freeze still resolves; nothing migrates it.
 */
export const settingsSchemaPathPattern = /\/schemas\/settings\/[^/]+\/[^/]+\.json$/i;

export const settingsSchemaPath = (schema: string): string | null =>
  settingsSchemaPathPattern.exec(schema.replace(/[?#].*$/, "").replaceAll("\\", "/"))?.[0] ?? null;
