/**
 * THE SDK FEED GUARD. `sdk adopt` reads a version folder in the manifest's release feed (ADR 0011).
 * `dotnet restore` says NU1301 with no fix; this guard says which files and where they come from.
 * The two pins move in lockstep (SDK doctor `lockstep-pins`); the guard repeats that so a half bump
 * fails here before it fails in Revit.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
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

it(`carries the pinned SDK family ${sdkPin} in the release feed`, () => {
  const { sdk } = json("product.payloads.json") as { sdk: { feed: string | null } };
  const feed = sdk.feed
    ? resolve(REPO, sdk.feed)
    : resolve(process.env.USERPROFILE ?? homedir(), "source/feeds/pe-revit-sdk");
  expect(readFileSync(resolve(REPO, "nuget.config"), "utf8")).toContain(
    `key="pe-revit-sdk" value="${feed}"`,
  );
  const missing = ["Pe.Revit.Sdk", "Pe.Revit.Cli"]
    .map((id) => resolve(feed, sdkPin, `${id}.${sdkPin}.nupkg`))
    .filter((path) => !existsSync(path));
  expect(
    missing,
    `publish ${sdkPin} into ${feed} with pe-revit release --feed, then pe-revit sdk adopt ${sdkPin}`,
  ).toEqual([]);
});
