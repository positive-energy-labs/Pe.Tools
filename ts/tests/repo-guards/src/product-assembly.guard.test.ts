import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createJiti } from "jiti";
import type { Layer } from "effect";
import type { HttpRouter as Http } from "effect/http";
import { expect, test } from "vite-plus/test";
import {
  productAssemblyPaths,
  productDependencyChanges,
  renderProductAssembly,
} from "../../../apps/web/scripts/product-assembly.ts";
import { routeFolderCandidates } from "@pe/web/route-startup";
import { ROOT } from "./import-census.ts";

const checkout = resolve(ROOT, "..");

test("every product declaration is in the checked-in assembly and workspace links", () => {
  const { outputs, dependencies } = renderProductAssembly(checkout);
  const stale = Object.entries(outputs).flatMap(([file, expected]) => {
    try {
      return readFileSync(join(checkout, file), "utf8").replaceAll("\r\n", "\n") === expected
        ? []
        : [file];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return [file];
    }
  });
  expect(stale, "Run codegen:routes to project the product declarations").toEqual([]);
  expect(productDependencyChanges(checkout, dependencies).map((change) => change.file)).toEqual([]);
});

const reference = (name: string) => ({ module: "./registration", export: name });
const contractManifest = {
  name: "@pe/proof-contract",
  exports: { "./registration": "./registration.ts" },
  pe: {
    tool: { ...reference("tool"), key: "proof" },
    reads: reference("reads"),
    http: { module: "./registration", routes: "routes", axes: "axes" },
    settings: { ...reference("settings"), key: "proof" },
    reading: reference("reading"),
    callPolicies: reference("policies"),
    guide: "./registration",
  },
};

const fixtureFiles = {
  "contract/package.json": JSON.stringify(contractManifest),
  "contract/registration.ts": [
    'import { z } from "zod";',
    'import { route } from "@pe/host-contracts/pe-api";',
    'export const tool = { name: "proof", says: "Fixture tool", commands: {',
    '  "document.temporary.status": { says: "Read fixture status", input: z.object({}), needs: "nothing", effect: "query", dirties: [] },',
    "} };",
    'export const reads = { inputs: { "proof.echo": z.object({ text: z.string() }) }, help: "A proof reading." };',
    'export const routes = { "proof.stats": route("GET", "/pe/proof", z.undefined(), z.object({ ok: z.boolean() }), "read", "gateway", "read") };',
    'export const axes = { "proof.stats": { subject: "None", cardinality: "One", touches: ["Metadata"], effect: "Read", cost: "Cheap", uses: [] } };',
    "export const settings = { bindings: [], at: () => null, accepts: () => false };",
    'export const reading = z.strictObject({ kind: z.literal("proof-reading"), id: z.string() });',
    'export const policies = { "document.temporary.status": { canonicalSession: true } };',
    'export const peaGuide = { instructions: "Fixture guide.", skills: [] };',
  ].join("\n"),
  "host/package.json": JSON.stringify({
    name: "@pe/proof-host",
    exports: { "./registration": "./registration.ts" },
    pe: {
      httpLayer: reference("httpLayer"),
      executors: { module: "./registration", factory: "executors", arguments: [] },
    },
  }),
  "host/registration.ts": [
    'import { HttpRouter, HttpServerResponse } from "effect/http";',
    'export const httpLayer = HttpRouter.add("GET", "/pe/proof", () => HttpServerResponse.json({ ok: true }));',
    'export const executors = () => ({ "proof.execute": { definition: "fixture executor" } });',
  ].join("\n"),
  "web/package.json": JSON.stringify({ name: "@pe/proof-web" }),
  "web/route.ts": 'export const module = { data: { key: "proof", address: "/proof" } };',
};

test("an authored product folder feeds Host, web and Pea without editing their sources", async () => {
  const root = mkdtempSync(join(tmpdir(), "pe-product-assembly-"));
  const product = "ts/products/proof/";
  const authored = Object.keys(fixtureFiles).map((path) => product + path);
  function write(file: string, source: string) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }
  try {
    for (const [file, source] of Object.entries(fixtureFiles)) write(product + file, source);
    console.log("Fixture authored only " + authored.join(", "));
    const assembly = renderProductAssembly(root);
    for (const [file, source] of Object.entries(assembly.outputs)) write(file, source);
    const helper = "ts/packages/mcps/src/pea/assembly-checks.ts";
    copyFileSync(join(checkout, helper), join(root, helper));

    const modules = [
      "@pe/agent-contracts/semantic-actions",
      "@pe/agent-contracts/pe-api",
      "@pe/agent-contracts",
      "@pe/host-contracts/pe-api",
      "effect/http",
      "effect",
    ];
    const jiti = createJiti(import.meta.url, {
      alias: {
        ...Object.fromEntries(
          modules.map((name) => [name, fileURLToPath(import.meta.resolve(name))]),
        ),
        zod: createRequire(new URL("../../../apps/web/package.json", import.meta.url)).resolve(
          "zod",
        ),
        "@pe/proof-contract/registration": join(root, product, "contract/registration.ts"),
        "@pe/proof-host/registration": join(root, product, "host/registration.ts"),
      },
    });
    const load = <T>(file: string) => jiti.import<T>(join(root, file));
    const actions = await load<typeof import("@pe/mcps/product-actions")>(
      productAssemblyPaths.actions,
    );
    const catalog = await load<typeof import("@pe/mcps/product-catalog")>(
      productAssemblyPaths.catalog,
    );
    const contracts = await load<typeof import("@pe/mcps/product-contracts")>(
      productAssemblyPaths.contracts,
    );
    const guides = await load<{ productGuides: readonly { instructions: string }[] }>(
      productAssemblyPaths.guides,
    );
    const host = await load<{ productHttpRoutes: Layer.Layer<never, never, Http.HttpRouter> }>(
      productAssemblyPaths.http,
    );
    const hostExecutors = await load<
      typeof import("../../../apps/host/src/product-executors.generated.ts")
    >(productAssemblyPaths.executors);
    const { HttpRouter } = await jiti.import<typeof import("effect/http")>("effect/http");
    const server = HttpRouter.toWebHandler(host.productHttpRoutes, { disableLogger: true });
    try {
      expect(await (await server.handler(new Request("http://fixture/pe/proof"))).json()).toEqual({
        ok: true,
      });
    } finally {
      await server.dispose();
    }
    expect(actions.tools).toHaveProperty("proof");
    expect(actions.commands).toHaveProperty(["document.temporary.status"]);
    expect(guides.productGuides).toEqual([{ instructions: "Fixture guide.", skills: [] }]);
    expect(hostExecutors.productExecutors({} as never).executors).toHaveProperty(["proof.execute"]);
    const discovery = catalog.linkedCatalog().entries.get("route:reads.value")?.discovery;
    expect(discovery?.description).toContain("A proof reading.");
    expect(discovery?.input).toMatchObject({
      anyOf: expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            read: expect.objectContaining({ const: "proof.echo" }),
          }),
        }),
      ]),
    });
    expect(catalog.matchPeRoute("GET", "/pe/proof")?.id).toBe("proof.stats");
    expect(catalog.linkedCatalog().entries.get("document.temporary.status")?.call).toEqual({
      canonicalSession: true,
    });
    expect(
      contracts.resourceReadingSchema.parse({ kind: "proof-reading", id: "fixture" }),
    ).toMatchObject({ id: "fixture" });
    expect(contracts.settingOwners).toHaveProperty("proof");
    mkdirSync(join(root, "ts/apps/web/src"), { recursive: true });
    expect(routeFolderCandidates(root)).toContain(join(root, product, "web"));
    const web = await load<{ module: { data: { address: string } } }>(product + "web/route.ts");
    expect(web.module.data.address).toBe("/proof");
    expect(assembly.dependencies).toEqual({
      "ts/packages/mcps/package.json": ["@pe/proof-contract"],
      "ts/apps/host/package.json": ["@pe/proof-contract", "@pe/proof-host"],
      "ts/apps/web/package.json": ["@pe/proof-web"],
    });

    write(
      product + "contract/package.json",
      JSON.stringify({
        ...contractManifest,
        pe: { ...contractManifest.pe, guide: "./missing" },
      }),
    );
    expect(() => renderProductAssembly(root)).toThrow("missing export ./missing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
