/**
 * THE SDK FEED GUARD. `sdk adopt` reads a version folder in the manifest's release feed (ADR 0011).
 * `dotnet restore` says NU1301 with no fix; this guard says which files and where they come from.
 * The two pins move in lockstep (SDK doctor `lockstep-pins`); the guard repeats that so a half bump
 * fails here before it fails in Revit.
 */
import { readFileSync } from "node:fs";
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
