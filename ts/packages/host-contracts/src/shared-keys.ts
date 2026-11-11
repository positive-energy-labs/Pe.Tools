/**
 * The shared keys file (ADR 0035 rule 11): `<shared>\keys.json`, a flat `{ name: value }` map the
 * firm drops on its shared root so a machine needs no per-user key. Every reader resolves the
 * user's own value first, then this file, then refuses with a typed reason: never a default.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { sharedKeysPath } from "./product-paths.ts";

export type KeyRefusal = "no-shared-root" | "no-shared-key" | "keys-unreadable";
export type ResolvedKey = { value: string; from: "user" | "shared" } | { refused: KeyRefusal };

const keysFile = z.record(z.string(), z.string().trim().min(1));

/**
 * FOOTGUN: keys.json is plaintext on a shared mount, readable by anyone with drive access, by the
 * owner's explicit choice ("i wont say this is a nice path, but having an easy thing like this is
 * useful in the many non-standards situation real life has"). Decode here and nowhere else; a
 * value leaves only to the reader that asked for it by name, never into Work, receipts, logs, Pea
 * context, telemetry or error text. A refusal names the file, never its bytes.
 */
export function sharedKeys(): { keys: Record<string, string> } | { refused: KeyRefusal } {
  const path = sharedKeysPath();
  if (path === null) return { refused: "no-shared-root" };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { keys: {} }
      : { refused: "keys-unreadable" };
  }
  try {
    const parsed = keysFile.safeParse(JSON.parse(text));
    return parsed.success ? { keys: parsed.data } : { refused: "keys-unreadable" };
  } catch {
    return { refused: "keys-unreadable" };
  }
}

/** The user's own key wins; else the shared key of that name; else a typed refusal. */
export function resolveKey(user: string | null | undefined, name: string): ResolvedKey {
  if (user?.trim()) return { value: user.trim(), from: "user" };
  const shared = sharedKeys();
  if ("refused" in shared) return shared;
  const value = Object.hasOwn(shared.keys, name) ? shared.keys[name] : undefined;
  return value ? { value, from: "shared" } : { refused: "no-shared-key" };
}

/** What a refusal says to a person: the reason and the fix, never a key byte. */
export const keyRefusalText = (refused: KeyRefusal, name: string): string =>
  refused === "no-shared-root"
    ? `No key '${name}': none of your own, and no shared root (set PE_TOOLS_SHARED_ROOT for the shared keys.json).`
    : refused === "no-shared-key"
      ? `No key '${name}': none of your own, and the shared keys.json has no '${name}'.`
      : `No key '${name}': the shared keys.json is unreadable or not a flat { name: value } map.`;
