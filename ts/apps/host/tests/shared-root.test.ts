import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { Effect, FileSystem } from "effect";
import { NodeServices } from "@effect/platform-node";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { contentHomes, sharedRoot, userRoot } from "@pe/host-contracts/product-paths";
import * as paths from "../src/product-paths.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { listPackages, readPackage } from "../src/packages.ts";
import { scratchPageDescriptors, scratchPageDirectory } from "../src/page-libraries.ts";
import { readDuctCatalogs } from "../src/duct-catalogs.ts";
import { writeMember } from "../src/settings.ts";
import { peaMcpServer } from "../src/harness/adapter.ts";

// ADR 0035 rule 11 (amended): the user root always, an optional shared root after it.
let user: string;
let shared: string;
beforeEach(() => {
  user = mkdtempSync(join(tmpdir(), "pe-user-"));
  shared = mkdtempSync(join(tmpdir(), "pe-shared-"));
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", user);
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", shared);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(user, { recursive: true, force: true });
  rmSync(shared, { recursive: true, force: true });
});
const under = (root: string, path: string) => {
  const away = relative(root, path);
  return !isAbsolute(away) && away !== ".." && !away.startsWith("../") && !away.startsWith("..\\");
};
const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
const pod = (home: string, folder: string, id: string, name: string) => {
  mkdirSync(join(home, "Pods", folder, "settings"), { recursive: true });
  writeFileSync(
    join(home, "Pods", folder, "pod.json"),
    JSON.stringify({ schemaVersion: 2, id, name, version: "0.1.0", entrypoints: [] }),
  );
};
const page = (home: string, slug: string, title: string) => {
  mkdirSync(join(home, "Pages", slug), { recursive: true });
  writeFileSync(join(home, "Pages", slug, "index.html"), `<title>${title}</title>`);
};
const catalog = (home: string, folder: string, id: string, title: string) => {
  mkdirSync(join(home, "Catalogs", folder), { recursive: true });
  writeFileSync(join(home, "Catalogs", folder, "source.pdf"), "%PDF-");
  const axis = { quantity: "q", unit: "u", values: [1, 2], input: { field: "flowCfm" } };
  const table = {
    id,
    title,
    source: { file: "source.pdf", title: "t", edition: "1", url: "https://x.test", page: 1, pdfPage: 1 },
    rows: axis,
    columns: axis,
    cells: { quantity: "q", unit: "u", values: [[1, 2], [3, 4]] },
    result: { from: "cells", quantity: "coefficient", unit: "1", toInWg: 1, velocityBasis: "connector", note: "n" },
  };
  writeFileSync(
    join(home, "Catalogs", folder, "catalog.json"),
    JSON.stringify({ version: 1, tables: [table] }),
  );
};

test("without a shared root the host's resolvers all answer, on the user root alone", () => {
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", "");
  expect(sharedRoot()).toBeNull();
  expect(contentHomes()).toEqual([user]);
  for (const [name, resolver] of Object.entries(paths)) expect(resolver, name).not.toThrow();
  expect(paths.productPodsRootPath()).toBe(join(user, "Pods"));
});

test("every content path and all Work sit in the user root; machine paths stay with their owner", () => {
  const content = new Set([
    "productUserContentRootPath",
    "productPodsRootPath",
    "productPagesRootPath",
    "productRouteWorkPath",
  ]);
  for (const [name, resolver] of Object.entries(paths)) {
    const path = resolver();
    expect(under(shared, path), `${name}: ${path}`).toBe(false);
    expect(under(content.has(name) ? user : hostOwnership.rootPath, path), name).toBe(true);
  }
  expect(paths.productRouteWorkPath()).toBe(join(userRoot(), "Work"));
});

test("a Pod in both homes resolves to the user's copy; a shared-only Pod still lists", async () => {
  pod(user, "mine", "duct-tools", "user copy");
  pod(shared, "firm", "duct-tools", "shared copy");
  pod(shared, "extras", "extras", "shared only");
  const listing = await listPackages();
  expect(listing.packages.map((p) => [p.id, p.name])).toEqual([
    ["duct-tools", "user copy"],
    ["extras", "shared only"],
  ]);
  expect(under(user, (await readPackage("duct-tools")).directory)).toBe(true);
});

test("a Page in both homes resolves to the user's copy", async () => {
  page(user, "tour", "user tour");
  page(shared, "tour", "shared tour");
  page(shared, "intro", "shared intro");
  const pages = await scratchPageDescriptors();
  expect(pages.map((p) => [p.slug, p.title]).sort()).toEqual([
    ["intro", "shared intro"],
    ["tour", "user tour"],
  ]);
  expect((await scratchPageDirectory("tour"))?.dir).toBe(join(user, "Pages", "tour"));
  expect((await scratchPageDirectory("intro"))?.dir).toBe(join(shared, "Pages", "intro"));
});

test("a Catalog in both homes resolves to the user's copy", async () => {
  catalog(user, "smacna", "round", "user round");
  catalog(shared, "smacna", "square", "shadowed folder");
  catalog(shared, "firm", "round", "shared round");
  catalog(shared, "oval", "oval", "shared oval");
  const reading = await readDuctCatalogs();
  expect(reading.findings).toEqual([]);
  expect(Object.values(reading.tables).map((t) => [t.id, t.title]).sort()).toEqual([
    ["oval", "shared oval"],
    ["round", "user round"],
  ]);
});

test("a write lands in the user root; a write into a shared Pod refuses", async () => {
  pod(user, "mine", "mine", "user");
  pod(shared, "theirs", "theirs", "shared");
  await run(writeMember({ pod: "mine", path: "settings/a.json", content: "{}" }));
  expect(readFileSync(join(user, "Pods", "mine", "settings", "a.json"), "utf8")).toBe("{}");
  await expect(
    run(writeMember({ pod: "theirs", path: "settings/a.json", content: "{}" })),
  ).rejects.toThrow("writes go to the user root only");
});

test("the harness declares the shared mount for its MCP child", () => {
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", " S:\\Pe.Tools ");
  expect(peaMcpServer(null, "http://localhost:1234", "test").env).toContainEqual({
    name: "PE_TOOLS_SHARED_ROOT",
    value: "S:\\Pe.Tools",
  });
});
