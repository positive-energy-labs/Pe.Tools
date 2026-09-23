/**
 * THE SDK FEED GUARD. `eng/sdk-feed` is machine-local (`.gitignore` excludes the nupkgs, ADR 0006
 * amendment 2026-09-22), so a fresh worktree restores nothing until the pinned family is copied in.
 * `dotnet restore` says NU1301 with no fix; this guard says which files and where they come from.
 * The two pins move in lockstep (SDK doctor `lockstep-pins`); the guard repeats that so a half bump
 * fails here before it fails in Revit.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const json = (rel: string): unknown =>
  JSON.parse(readFileSync(resolve(REPO, rel), "utf8").replace(/^﻿/, ""));

const sdkPin = (json("global.json") as { "msbuild-sdks": { "Pe.Revit.Sdk": string } })[
  "msbuild-sdks"
]["Pe.Revit.Sdk"];
const cliPin = (
  json(".config/dotnet-tools.json") as { tools: { "pe.revit.cli": { version: string } } }
).tools["pe.revit.cli"].version;

it("pins Pe.Revit.Sdk and pe.revit.cli in lockstep", () => {
  expect(cliPin).toBe(sdkPin);
});

it(`carries the pinned SDK family ${sdkPin} in eng/sdk-feed`, () => {
  const missing = ["Pe.Revit.Sdk", "Pe.Revit.Cli"]
    .map((id) => `eng/sdk-feed/${id}.${sdkPin}.nupkg`)
    .filter((rel) => !existsSync(resolve(REPO, rel)));
  expect(
    missing,
    `copy the ${sdkPin} nupkgs from Pe.Revit.Sdk\\.artifacts\\feed (or the main checkout's eng/sdk-feed) into this worktree; never junction or symlink the dir`,
  ).toEqual([]);
});
