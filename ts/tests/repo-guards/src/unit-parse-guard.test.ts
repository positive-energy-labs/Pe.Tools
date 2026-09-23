import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const here = dirname(fileURLToPath(import.meta.url));
const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: here,
  encoding: "utf8",
}).trim();
const sources = execFileSync("git", ["ls-files", "*.cs"], { cwd: repo, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

describe("one text→value parse for a measurable spec", () => {
  it("calls Revit's unit parser only inside UnitValueResolver", () => {
    const callers = sources.filter((path) =>
      readFileSync(resolve(repo, path), "utf8").includes("UnitFormatUtils.TryParse"),
    );
    expect(callers).toEqual(["dotnet/Pe.Revit/Parameters/UnitValueResolver.cs"]);
  });
});
