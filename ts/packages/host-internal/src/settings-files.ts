import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { SETTING_TIERS, type SettingTier, type SettingTierRead } from "@pe/agent-contracts";
import {
  firmHome,
  noFirmHomeText,
  projectHome,
  sharedDriveRoot,
  userRoot,
} from "@pe/host-contracts/product-paths";
import { productPathNames } from "@pe/host-contracts/contracts";
import { sha256Hex } from "@pe/host-contracts/kinds";
import { firmOwner } from "./reads/door.ts";

export function tierHome(
  tier: SettingTier,
  pointer: string | null | undefined,
): Pick<SettingTierRead, "home" | "name" | "notFound"> {
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
    notFound:
      pointer && sharedDriveRoot() === null
        ? `No project home: the model names "${pointer}" relative to the shared drive root, which cannot be resolved because no firm home was found.`
        : pointer
          ? `No project home: the model names "${pointer}", and no folder with a ${productPathNames.homeMarkerFileName} of tier "project" is there.`
          : "No project home: this model names none, or no model is the target.",
  };
}

/**
 * The one reader of a `Settings/<owner>.json` file, in any home: absent (no hash and no error), or
 * its hash with its JSON object. A file that is not a JSON object is kept and reported, never used.
 */
export function readSettingsFile(path: string): Pick<SettingTierRead, "sha256" | "json" | "error"> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { sha256: null }
      : { sha256: null, error: String(error) };
  }
  const sha256 = sha256Hex(bytes);
  try {
    const json: unknown = JSON.parse(bytes.toString("utf8").replace(/^﻿/, ""));
    return json !== null && typeof json === "object" && !Array.isArray(json)
      ? { sha256, json }
      : { sha256, error: "The file is not a JSON object" };
  } catch (error) {
    return { sha256, error: String(error) };
  }
}

/** One tier's file as it stands. */
export function readTier(
  tier: SettingTier,
  owner: string,
  pointer: string | null | undefined,
): SettingTierRead {
  const at = tierHome(tier, pointer);
  if (at.home === null) return { tier, ...at, path: null, sha256: null };
  const path = join(
    at.home,
    productPathNames.homeSettingsDirectoryName,
    `${firmOwner.parse(owner)}.json`,
  );
  return { tier, ...at, path, ...readSettingsFile(path) };
}

/** Every tier's file for one owner, most specific first. `pointer` is the target model's project pointer. */
export const readSettingTiers = (owner: string, pointer?: string | null): SettingTierRead[] =>
  SETTING_TIERS.map((tier) => readTier(tier, owner, pointer));
