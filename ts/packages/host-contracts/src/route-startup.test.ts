import { afterEach, expect, test } from "vite-plus/test";
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  currentRouteStartupProjection,
  readRouteStartupReceipt,
  routeStartupOwner,
  routeStartupReceiptPath,
  routeStartupSourceHash,
  writeRouteStartupReceipt,
} from "./route-startup.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "route-startup-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  const put = (id: string, text: string) => {
    mkdirSync(dirname(join(root, id)), { recursive: true });
    writeFileSync(join(root, id), text);
  };
  put(".gitignore", "node_modules/\nignored/\n");
  put("ts/apps/web/src/a/route.ts", "export const module = {};\n");
  put("ts/tests/unrelated.test.ts", "export const test = 1;\n");
  put("ts/tests/imported.test.ts", "export const value = 1;\n");
  put("ts/node_modules/dep/index.js", "export const dep = 1;\n");
  const members = ["ts/apps/web/src/a/route.ts", "ts/tests/imported.test.ts", "ts/node_modules/dep/index.js"];
  const projections = { [join(root, "ts/apps/web/src/a/source-closure.generated.json")]: JSON.stringify({
    envelope: { modules: members.map(id => ({ id, sha256: createHash("sha256")
      .update(readFileSync(join(root, id), "utf8").replaceAll("\r\n", "\n")).digest("hex") })), inputs: [] },
  }) };
  const sourceHash = routeStartupSourceHash(root);
  const receipt = { checkout: routeStartupOwner(root), sourceHash, projections };
  return { root, put, receipt, projections, sourceHash };
}

test("test bodies stay conservative, including inputs outside builtin closures", () => {
  const f = fixture();
  writeRouteStartupReceipt(f.root, f.sourceHash, f.projections);
  expect(readRouteStartupReceipt(f.root)).toEqual(f.receipt);
  f.put("ts/tests/unrelated.test.ts", "export const test = 2;\n");
  expect(readRouteStartupReceipt(f.root)).toBeUndefined();
  f.put("ts/tests/unrelated.test.ts", "export const test = 1;\n");
  for (const id of ["ts/tests/imported.test.ts", "ts/node_modules/dep/index.js"]) {
    const original = readFileSync(join(f.root, id), "utf8");
    f.put(id, original + "// edited\n");
    expect(readRouteStartupReceipt(f.root), id).toBeUndefined();
    f.put(id, original);
  }
});

test("route, barrel, configuration, lockfile and inventory changes still invalidate", () => {
  const f = fixture();
  for (const id of ["ts/apps/web/src/a/route.ts", "ts/packages/shared/index.ts", "ts/tsconfig.json",
    "ts/package.json", "ts/pnpm-lock.yaml", "ts/apps/web/scripts/route-graphs.ts",
    "ts/tests/new.test.ts", "ts/apps/web/src/new/route.ts"]) {
    const path = join(f.root, id);
    let original: string | undefined;
    try { original = readFileSync(path, "utf8"); } catch { /* New input. */ }
    f.put(id, "// changed\n");
    expect(currentRouteStartupProjection(f.root, f.receipt), id).toBe(false);
    if (original === undefined) rmSync(path); else f.put(id, original);
    expect(currentRouteStartupProjection(f.root, f.receipt), id).toBe(true);
  }
  rmSync(join(f.root, "ts/tests/unrelated.test.ts"));
  expect(currentRouteStartupProjection(f.root, f.receipt)).toBe(false);
});

test.each(["route.ts", "graph.ts"])("ignored %s discovery refuses reuse, including after publication", (name) => {
  const f = fixture();
  writeRouteStartupReceipt(f.root, f.sourceHash, f.projections);
  f.put(`ts/apps/web/src/ignored/${name}`, "export const module = {};\n");
  expect(routeStartupSourceHash(f.root)).toBe(f.sourceHash);
  expect(readRouteStartupReceipt(f.root)).toBeUndefined();
  expect(currentRouteStartupProjection(f.root, f.receipt)).toBe(false);
  rmSync(routeStartupReceiptPath(f.root));
  writeRouteStartupReceipt(f.root, f.sourceHash, f.projections);
  expect(() => readFileSync(routeStartupReceiptPath(f.root))).toThrow();
});

test("an ignored declaration in an otherwise visible folder also disables the receipt", () => {
  const f = fixture();
  f.put(".gitignore", "node_modules/\nroute.ts\n");
  writeRouteStartupReceipt(f.root, routeStartupSourceHash(f.root), f.projections);
  expect(readRouteStartupReceipt(f.root)).toBeUndefined();
});

test("concurrent producers publish a complete receipt and leave no temporary files", async () => {
  const f = fixture();
  const payload = join(f.root, "receipt.json");
  writeFileSync(payload, JSON.stringify(f.receipt));
  const script = `import { readFileSync } from 'node:fs';
    import { writeRouteStartupReceipt } from ${JSON.stringify(new URL("./route-startup.ts", import.meta.url).href)};
    const receipt = JSON.parse(readFileSync(process.argv[1], 'utf8'));
    writeRouteStartupReceipt(process.argv[2], receipt.sourceHash, receipt.projections);`;
  await Promise.all([1, 2].map(() => promisify(execFile)(process.execPath,
    ["--input-type=module", "-e", script, payload, f.root])));
  expect(readRouteStartupReceipt(f.root)).toEqual(f.receipt);
  expect(readdirSync(dirname(routeStartupReceiptPath(f.root)))).toEqual(["route-projection.json"]);
});

test("owner identity, missing members, racing edits and malformed publication fail closed", () => {
  const f = fixture();
  expect(currentRouteStartupProjection(f.root, { ...f.receipt, checkout: "another checkout" })).toBe(false);
  f.put("ts/apps/web/src/a/route.ts", "// edit during production\n");
  writeRouteStartupReceipt(f.root, f.sourceHash, f.projections);
  expect(readRouteStartupReceipt(f.root)).toBeUndefined();
  rmSync(join(f.root, "ts/node_modules/dep/index.js"));
  expect(currentRouteStartupProjection(f.root, f.receipt)).toBe(false);
  f.put("ts/apps/web/node_modules/.cache/route-projection.json", "{");
  expect(readRouteStartupReceipt(f.root)).toBeUndefined();
});
