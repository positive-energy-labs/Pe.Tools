/**
 * Secrets by role (ADR 0037 rule 9). A key is asked for by what it is for, never by a provider
 * record's id. Every reader resolves the person's own value first, then the firm home's
 * `keys.json` (a flat `{ role: value }` map), then refuses with a typed reason: never a default.
 */
import { z } from "zod";
import { firmHome, firmKeysPath, noFirmHomeText } from "./product-paths.ts";
import { readStored } from "./store.ts";

/** Frozen: these are the names a firm writes into `keys.json` (homes freeze shape 9). */
export const keyRoles = ["openai.api-key", "anthropic.api-key", "llamaparse.api-key"] as const;
/** `posthog.api-key` is the dev lane's ingest key: a firm file may carry it, a coworker never needs it. */
export type KeyRole = (typeof keyRoles)[number] | "posthog.api-key";
/** The model key each lab harness spends. */
export const harnessKeyRole = {
  claude: "anthropic.api-key",
  codex: "openai.api-key",
} as const satisfies Record<string, KeyRole>;

export type KeyRefusal = "no-shared-root" | "no-shared-key" | "keys-unreadable";
export type ResolvedKey = { value: string; from: "user" | "shared" } | { refused: KeyRefusal };

const keysFile = z.record(z.string(), z.string().trim().min(1));

/**
 * FOOTGUN: keys.json is plaintext on a shared mount, readable by anyone with drive access, by the
 * owner's explicit choice ("i wont say this is a nice path, but having an easy thing like this is
 * useful in the many non-standards situation real life has"). Decode here and nowhere else; a
 * value leaves only to the reader that asked for it by role, never into Work, receipts, logs, Pea
 * context, telemetry or error text. A refusal names the file, never its bytes.
 */
export function sharedKeys(): { keys: Record<string, string> } | { refused: KeyRefusal } {
  const path = firmKeysPath();
  if (path === null) return { refused: "no-shared-root" };
  // An authored file: one that does not decode is kept and refused, and its reason stays unread
  // here because a decode reason can quote the bytes.
  const read = readStored(path, keysFile, { class: "keep", place: "Firm keys" });
  return read.kind === "ok"
    ? { keys: read.value }
    : read.kind === "missing"
      ? { keys: {} }
      : { refused: "keys-unreadable" };
}

/** The person's own key wins; else the firm key of that role; else a typed refusal. */
export function resolveKey(user: string | null | undefined, role: KeyRole): ResolvedKey {
  if (user?.trim()) return { value: user.trim(), from: "user" };
  const shared = sharedKeys();
  if ("refused" in shared) return shared;
  const value = Object.hasOwn(shared.keys, role) ? shared.keys[role] : undefined;
  return value ? { value, from: "shared" } : { refused: "no-shared-key" };
}

/** What a refusal says to a person: the reason and where it looked, never a key byte. */
export const keyRefusalText = (refused: KeyRefusal, role: KeyRole): string =>
  refused === "no-shared-root"
    ? `No key '${role}': none of your own. ${noFirmHomeText(firmHome())}`
    : refused === "no-shared-key"
      ? `No key '${role}': none of your own, and the firm keys.json has no '${role}'.`
      : `No key '${role}': the firm keys.json is unreadable or not a flat { role: value } map.`;
