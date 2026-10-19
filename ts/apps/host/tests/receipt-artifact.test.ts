import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
// @ts-expect-error untyped build script
import { splitWebMaps } from "../scripts/web-maps.mjs";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function client(map: Record<string, unknown>, chunk = "console.log(1);\n//# debugId=d-1\n") {
  const root = mkdtempSync(join(tmpdir(), "pe-web-maps-"));
  roots.push(root);
  mkdirSync(join(root, "client", "assets"), { recursive: true });
  writeFileSync(join(root, "client", "index.html"), "<html></html>");
  writeFileSync(join(root, "client", "assets", "a.js"), chunk);
  writeFileSync(
    join(root, "client", "assets", "a.js.map"),
    JSON.stringify({ version: 3, sources: ["ts/apps/web/src/a.ts"], debugId: "d-1", ...map }),
  );
  return {
    split: () =>
      splitWebMaps(join(root, "client"), join(root, "served"), join(root, "maps")) as {
        asset: string;
        debugId: string;
      }[],
    root,
  };
}

test("a hidden, source-free, repo-relative map leaves the served tree and keys the private manifest", () => {
  const { split, root } = client({ sourcesContent: [null] });
  expect(split()).toMatchObject([{ asset: "assets/a.js", debugId: "d-1" }]);
  expect(existsSync(join(root, "served", "index.html"))).toBe(true);
  expect(existsSync(join(root, "served", "assets", "a.js"))).toBe(true);
  expect(existsSync(join(root, "served", "assets", "a.js.map"))).toBe(false);
  expect(existsSync(join(root, "maps", "assets", "a.js.map"))).toBe(true);
  const manifest = JSON.parse(readFileSync(join(root, "maps", "maps.json"), "utf8"));
  expect(manifest.maps[0]).toMatchObject({ asset: "assets/a.js", map: "assets/a.js.map" });
});

test.each([
  ["embedded source text", { sourcesContent: ["secret"] }, undefined, /embeds source text/],
  ["a drive path", { sources: ["C:/Users/me/repo/a.ts"] }, undefined, /workstation paths/],
  ["a rooted path", { sources: ["/home/me/a.ts"] }, undefined, /workstation paths/],
  ["no debug id", { debugId: undefined }, undefined, /no debug id/],
  ["a chunk with another debug id", {}, "x;\n//# debugId=d-2\n", /does not carry/],
  ["a public map link", {}, "x;\n//# debugId=d-1\n//# sourceMappingURL=a.js.map\n", /publicly/],
])("refuses %s and stages nothing", (_, map, chunk, reason) => {
  const { split, root } = client(map, chunk);
  expect(split).toThrow(reason);
  expect(existsSync(join(root, "served"))).toBe(false);
  expect(existsSync(join(root, "maps"))).toBe(false);
});

test("a library regex that merely mentions sourceMappingURL is not a link", () => {
  const { split } = client({}, "var r=/\\/\\/[@#] sourceMappingURL=([^\\s]+)/;\n//# debugId=d-1\n");
  expect(split()).toHaveLength(1);
});
