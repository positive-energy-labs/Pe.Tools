import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

it("native loss server only consumes host-priced results, with no table or parameter fallback", () => {
  const server = source("dotnet/Pe.Revit.Global/Lib/Mep/PeLossServer.cs");
  expect(server).toContain("DuctLossResult");
  expect(server).toContain("matches.Count != 1");
  expect(server).not.toMatch(
    /Ashrae|lookup|LookupParameter|DuctFittingPricing|DuctFittingGeometry/,
  );
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() && !["bin", "obj"].includes(e.name)
        ? walk(resolve(dir, e.name))
        : e.isFile() && e.name.endsWith(".cs")
          ? [resolve(dir, e.name)]
          : [],
    );
  for (const file of walk(resolve(root, "dotnet")))
    expect(readFileSync(file, "utf8"), file).not.toMatch(
      /class\s+(?:DuctFittingPricing|AshraeLookup)\b/,
    );
  expect(source("ts/apps/host/src/ducts-actions.ts")).not.toContain(
    "Loss server cannot price table",
  );
});
