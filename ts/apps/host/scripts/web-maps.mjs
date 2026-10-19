// Splits a built web client into the served tree (no maps) and a private map artifact for
// symbolication. Refuses a map that embeds source text, names a workstation path, lacks a debug
// id its chunk also carries, or a chunk that links a map publicly.
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const workstation = /^[a-zA-Z]:|^[\\/]|\\|(^|\/)Users\//;

/** @returns {{ asset: string; map: string; debugId: string; assetSha256: string; mapSha256: string }[]} */
export function splitWebMaps(clientDir, servedDir, mapsDir) {
  const files = readdirSync(clientDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(clientDir, join(entry.parentPath, entry.name)).split("\\").join("/"));
  const problems = [];
  const entries = [];
  for (const name of files.filter((file) => /\.(js|mjs|css)$/.test(file))) {
    if (
      /^\s*(\/\/|\/\*)[#@]\s*sourceMappingURL=/m.test(readFileSync(join(clientDir, name), "utf8"))
    )
      problems.push(`${name} links a source map publicly`);
  }
  for (const map of files.filter((file) => file.endsWith(".map"))) {
    const asset = map.slice(0, -4);
    const json = JSON.parse(readFileSync(join(clientDir, map), "utf8"));
    if (json.sourcesContent?.some((text) => text != null))
      problems.push(`${map} embeds source text`);
    const leaked = (json.sources ?? []).filter((source) => workstation.test(source));
    if (leaked.length)
      problems.push(`${map} names workstation paths: ${leaked.slice(0, 3).join(", ")}`);
    const debugId = json.debugId;
    if (typeof debugId !== "string" || !debugId) {
      problems.push(`${map} has no debug id`);
      continue;
    }
    if (!files.includes(asset)) {
      problems.push(`${map} has no chunk ${asset}`);
      continue;
    }
    if (!readFileSync(join(clientDir, asset), "utf8").includes(`debugId=${debugId}`))
      problems.push(`${asset} does not carry its map's debug id ${debugId}`);
    entries.push({
      asset,
      map,
      debugId,
      assetSha256: sha256(join(clientDir, asset)),
      mapSha256: sha256(join(clientDir, map)),
    });
  }
  if (problems.length) throw new Error(`web source maps refused:\n${problems.join("\n")}`);
  rmSync(servedDir, { recursive: true, force: true });
  cpSync(clientDir, servedDir, { recursive: true, filter: (path) => !path.endsWith(".map") });
  rmSync(mapsDir, { recursive: true, force: true });
  for (const { map } of entries) {
    mkdirSync(dirname(join(mapsDir, map)), { recursive: true });
    cpSync(join(clientDir, map), join(mapsDir, map));
  }
  mkdirSync(mapsDir, { recursive: true });
  writeFileSync(
    join(mapsDir, "maps.json"),
    `${JSON.stringify({ schema: 1, maps: entries }, null, 2)}\n`,
  );
  return entries;
}
