import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { renderRoutesCs, ROUTES_CS } from "../scripts/route-links-cs.ts";
import { routeAddresses } from "./routes/index.ts";

describe("the C# route table", () => {
  test("is the contract's: a route or key changed without `pnpm codegen:routes` fails here", () => {
    const found = readFileSync(ROUTES_CS, "utf8").replaceAll("\r\n", "\n");
    expect(found).toBe(renderRoutesCs());
  });

  test("names every route's path and carries no draft key", () => {
    const text = renderRoutesCs();
    expect(text).toContain('public const string Path = "/pods";');
    expect(text).toContain('public const string Pod = "pod";');
    for (const key of ["ThreadSearch", "ThreadSort"])
      expect(text.match(new RegExp(`public const string ${key} =`, "g"))).toHaveLength(
        Object.keys(routeAddresses).length,
      );
    // `prompt` is Pea's composer draft (share: false): never in a link, so never in a table of link keys.
    expect(text).not.toContain('"prompt"');
  });
});
