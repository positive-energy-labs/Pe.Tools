import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostOwnership } from "./host-ownership.ts";

const PAGE_KIT_FILES = ["pe-kit.js", "pe-kit.css"] as const;
export async function pageKitAsset(name: string) {
  if (!PAGE_KIT_FILES.includes(name as (typeof PAGE_KIT_FILES)[number]))
    throw Error(`No Page kit asset ${name}`);
  const path =
    hostOwnership.lane === "installed"
      ? join(dirname(process.execPath), "pages", "kit", name)
      : fileURLToPath(new URL(`../../../packages/kit/dist/${name}`, import.meta.url));
  return readFile(path, "utf8");
}
