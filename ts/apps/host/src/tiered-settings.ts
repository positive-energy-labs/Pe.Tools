/**
 * Tiered settings (ADR 0037 rule 8; homes MAP slice 6b): `Settings/<owner>.json` in the user home,
 * the target model's project home and the firm home. A read returns every tier's file as it stands
 * with the home it came from, so a sheet can say which tier served a value. A write goes through
 * the one home write door (`writeHome`: compare-and-swap, prior bytes kept) and posts one notice
 * that names the file, the writer and the receipt.
 */
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import type { SettingTier, SettingTierRead } from "@pe/agent-contracts";
import { DUCTS_CRITERIA_CELLS, SETTING_TIERS, ductsFirmSchema } from "@pe/agent-contracts";
import {
  firmHome,
  noFirmHomeText,
  projectHome,
  sharedDriveRoot,
  userRoot,
} from "@pe/host-contracts/product-paths";
import { productPathNames } from "@pe/host-contracts/contracts";
import { noteStored, sha256Hex } from "@pe/host-contracts/store";
import { SETTING_WRITE_PLACE, storedNoticesPath } from "./notice-feed.ts";
import { firmOwner } from "./reads/door.ts";
import { writeHome } from "./settings.ts";

/** A tier's home for the target model: its folder and its name, or why there is none. */
function tierHome(tier: SettingTier, pointer: string | null | undefined): Pick<SettingTierRead, "home" | "name" | "notFound"> {
  if (tier === "user") {
    const home = userRoot();
    return { home, name: basename(home) };
  }
  if (tier === "firm") {
    const firm = firmHome();
    const drive = sharedDriveRoot();
    return firm.root
      ? { home: firm.root, name: basename(drive ?? firm.root) }
      : { home: null, name: null, notFound: noFirmHomeText(firm) };
  }
  const home = projectHome(pointer);
  // Pe's files sit in one child folder of the folder the humans use; that folder is the name.
  if (home) return { home, name: basename(dirname(home)) };
  return {
    home: null,
    name: null,
    notFound: pointer && sharedDriveRoot() === null
      ? `No project home: the model names "${pointer}" relative to the shared drive root, which cannot be resolved because no firm home was found.`
      : pointer
      ? `No project home: the model names "${pointer}", and no folder with a ${productPathNames.homeMarkerFileName} of tier "project" is there.`
      : "No project home: this model names none, or no model is the target.",
  };
}

/** One tier's file as it stands. A file that is not a JSON object is kept and reported, never used. */
function readTier(tier: SettingTier, owner: string, pointer: string | null | undefined): SettingTierRead {
  const at = tierHome(tier, pointer);
  if (at.home === null) return { tier, ...at, path: null, sha256: null };
  const path = join(at.home, productPathNames.homeSettingsDirectoryName, `${firmOwner.parse(owner)}.json`);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { tier, ...at, path, sha256: null }
      : { tier, ...at, path, sha256: null, error: String(error) };
  }
  const sha256 = sha256Hex(bytes);
  try {
    const json: unknown = JSON.parse(bytes.toString("utf8").replace(/^﻿/, ""));
    return json !== null && typeof json === "object" && !Array.isArray(json)
      ? { tier, ...at, path, sha256, json }
      : { tier, ...at, path, sha256, error: "The file is not a JSON object" };
  } catch (error) {
    return { tier, ...at, path, sha256, error: String(error) };
  }
}

/** Every tier's file for one owner, most specific first. `pointer` is the target model's project pointer. */
export const readSettingTiers = (owner: string, pointer?: string | null): SettingTierRead[] =>
  SETTING_TIERS.map((tier) => readTier(tier, owner, pointer));

const listeners = new Set<() => void>();
/** A setting write on this host; the read graph invalidates its settings inputs on it. */
export const onSettingWritten = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export type SettingWrite =
  | { ok: true; tier: SettingTier; path: string; sha256: string; priorSha256: string | null; by: string; at: string }
  | { ok: false; status: 404 | 409 | 422; message: string };

/**
 * Save one value at one tier. The file is rewritten with the value at `path` (null removes it) and
 * the writer's stamp, on the hash the writer read; a file changed since then is a conflict, and a
 * home that was not found is refused, never written somewhere else.
 */
/**
 * A declared ducts cell accepts the value (`null` clears it). Criteria cells check their own
 * schema; the whole-key settings (`designFriction`, one `parameters` slot) check through the tier
 * file's schema on a file holding only that value, so a bad sibling never blocks a good write.
 */
function ductsCellAccepts(path: readonly string[], value: unknown): boolean {
  const criteria = Object.values(DUCTS_CRITERIA_CELLS).find((declared) =>
    ["criteria", ...declared.layer].length === path.length &&
    ["criteria", ...declared.layer].every((key, index) => key === path[index]));
  if (criteria) return value === null || criteria.value.safeParse(value).success;
  const probe =
    path.length === 1 && path[0] === "designFriction" ? { designFriction: value } :
    path.length === 2 && path[0] === "parameters" ? { parameters: { [path[1]!]: value } } :
    null;
  return probe !== null && (value === null || ductsFirmSchema.safeParse(probe).success);
}

export function writeSettingTier(
  request: { owner: string; tier: SettingTier; path: readonly string[]; value: unknown; expectedSha256: string | null },
  context: { pointer?: string | null; writer?: string; now?: () => Date } = {},
): SettingWrite {
  if (request.path.some((key) => ["written", "__proto__", "constructor", "prototype"].includes(key)))
    return { ok: false, status: 422, message: "The setting path contains a reserved key." };
  const read = readTier(request.tier, request.owner, context.pointer);
  if (read.home === null || read.path === null)
    return { ok: false, status: 404, message: read.notFound ?? `No ${request.tier} home` };
  if (read.error !== undefined)
    return { ok: false, status: 422, message: `${read.path} can't be read, so it is kept as it is: ${read.error}` };
  if (read.sha256 !== request.expectedSha256)
    return { ok: false, status: 409, message: `${read.path} changed since it was read.` };
  if (request.owner !== "ducts" || !ductsCellAccepts(request.path, request.value))
    return { ok: false, status: 422, message: `No declared setting accepts ${request.owner} ${request.path.join(".")} with that value.` };
  const by = context.writer ?? userInfo().username;
  const at = (context.now?.() ?? new Date()).toISOString();
  const next = structuredClone((read.json ?? {}) as Record<string, unknown>);
  let node = next;
  for (const key of request.path.slice(0, -1)) {
    const child = node[key];
    node = node[key] = child !== null && typeof child === "object" && !Array.isArray(child) ? (child as Record<string, unknown>) : {};
  }
  const leaf = request.path.at(-1)!;
  if (request.value == null) delete node[leaf];
  else node[leaf] = request.value;
  next.written = { by, at };
  const wrote = writeHome(read.path, `${JSON.stringify(next, null, 2)}\n`, request.expectedSha256);
  if (!wrote.ok) return { ok: false, status: 409, message: `${read.path} changed since it was read.` };
  noteStored(storedNoticesPath(), {
    class: "keep",
    place: SETTING_WRITE_PLACE,
    path: read.path,
    sha256: wrote.sha256,
    reason: `${by} ${request.value == null ? "cleared" : `set ${JSON.stringify(request.value)} at`} ${request.owner} ${request.path.join(".")} in the ${request.tier} home${read.name ? ` (${read.name})` : ""}. ${
      wrote.priorSha256 ? `The bytes before it are kept: sha256 ${wrote.priorSha256}.` : "The file is new."
    }`,
  });
  for (const listener of listeners) listener();
  return { ok: true, tier: request.tier, path: read.path, sha256: wrote.sha256, priorSha256: wrote.priorSha256, by, at };
}
