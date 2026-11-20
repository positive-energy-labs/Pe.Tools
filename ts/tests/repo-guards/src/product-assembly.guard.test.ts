import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createJiti } from "jiti";
import { expect, test } from "vite-plus/test";
import {
  productAssemblyPaths,
  productDependencyChanges,
  renderProductAssembly,
} from "../../../apps/web/scripts/product-assembly.ts";
import { routeFolderCandidates } from "@pe/web/route-startup";
import {
  commandTableSource,
  generateCommandTable,
} from "../../../packages/mcps/scripts/command-axes.ts";
import { execFileSync } from "node:child_process";
import { ROOT } from "./import-census.ts";

const checkout = resolve(ROOT, "..");

test("the native home table is fresh against C#", () => {
  execFileSync(process.execPath, [
    join(ROOT, "packages/host-contracts/scripts/ops-catalog-hash.ts"),
  ]);
});

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

const freshCommand = "proof.inspect-fresh-assembly";
const contractManifest = {
  name: "@pe/proof-contract",
  exports: { "./product": "./src/product.ts" },
};

test("only generated workspace markers remain in the package manifests", () => {
  for (const file of execFileSync("git", ["ls-files", "--", "*/package.json", "package.json"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .trim()
    .split("\n"))
    expect(
      Object.keys(JSON.parse(readFileSync(join(ROOT, file), "utf8")).pe ?? {}).filter(
        (key) => key !== "generatedProductDependencies",
      ),
      file,
    ).toEqual([]);
});

const fixtureFiles = {
  "contract/package.json": JSON.stringify(contractManifest),
  "contract/src/product.ts": [
    'import { z } from "zod";',
    'import { homeFile, product as declare } from "@pe/agent-contracts/product";',
    'import { contract } from "@pe/agent-contracts/handle";',
    "export const product = declare({",
    '  id: "proof",',
    '  says: "Fixture tool",',
    '  homes: { standards: homeFile("proof") },',
    "  cells: {},",
    '  readings: { echo: { handle: contract("proof.echo", { input: z.strictObject({ kind: z.literal("proof-reading"), text: z.string() }), data: z.string(), uses: [] }), sources: [], says: "A proof reading.", load: { resource: true, calls: { "document.temporary.status": { canonicalSession: true } } } } },',
    `  commands: { "${freshCommand}": { says: "Read fixture status", input: z.object({}), needs: "nothing", effect: "query", catalogEffect: "Read", dirties: [], native: [], writes: {} } },`,
    "  routes: {},",
    '  guide: { instructions: "Fixture guide.", skills: [] },',
    "});",
  ].join("\n"),
  "host/package.json": JSON.stringify({
    name: "@pe/proof-host",
    exports: { "./product": "./src/product.ts" },
  }),
  "host/src/product.ts": [
    'import { implement } from "@pe/host-internal/product";',
    'import { product } from "@pe/proof-contract/product";',
    "export const host = implement(product, {",
    "  readings: { echo: (_ctx, args) => args.text },",
    `  commands: { "${freshCommand}": () => ({ definition: "fixture executor" }) },`,
    "});",
  ].join("\n"),
  "web/package.json": JSON.stringify({ name: "@pe/proof-web" }),
  "web/route.ts": 'export const module = { data: { key: "proof", address: "/proof" } };',
};

const product = "ts/products/proof/";
function writeAssemblyFixture(root: string, declaration = fixtureFiles["contract/src/product.ts"]) {
  const authored = Object.keys(fixtureFiles).map((path) => product + path);
  function write(file: string, source: string) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }
  for (const [file, source] of Object.entries(fixtureFiles))
    write(product + file, file === "contract/src/product.ts" ? declaration : source);
  const assembly = renderProductAssembly(root);
  for (const [file, source] of Object.entries(assembly.outputs)) write(file, source);
  for (const helper of [
    "ts/packages/mcps/src/pea/assembly-checks.ts",
    "ts/apps/host/src/product-runtime.ts",
  ])
    copyFileSync(join(checkout, helper), join(root, helper));
  return { assembly, authored, write };
}

function loadFixtureModules(root: string, commandTable?: string) {
  const modules = [
    "@pe/agent-contracts/semantic-actions",
    "@pe/agent-contracts/pe-api",
    "@pe/agent-contracts/product",
    "@pe/agent-contracts/handle",
    "@pe/agent-contracts/native-output-read",
    "@pe/agent-contracts/route-state",
    "@pe/agent-contracts/target",
    "@pe/agent-contracts/tiered-setting",
    "@pe/agent-contracts/slots",
    "@pe/agent-contracts",
    "@pe/host-contracts/catalog",
    "@pe/host-contracts/pe-api",
    "effect/http",
    "effect",
  ];
  const jiti = createJiti(import.meta.url, {
    // The production generator loads the catalog in a fresh process after writing the table.
    moduleCache: !commandTable,
    alias: {
      ...Object.fromEntries(
        modules.map((name) => [name, fileURLToPath(import.meta.resolve(name))]),
      ),
      zod: createRequire(new URL("../../../apps/web/package.json", import.meta.url)).resolve("zod"),
      "@pe/host-internal/product": join(ROOT, "packages/host-internal/src/product.ts"),
      "@pe/proof-contract/product": join(root, product, "contract/src/product.ts"),
      "@pe/proof-host/product": join(root, product, "host/src/product.ts"),
      ...(commandTable ? { "./generated/command-axes.generated.ts": commandTable } : {}),
    },
  });
  return { jiti, load: <T>(file: string) => jiti.import<T>(join(root, file)) };
}

test.each([
  ['"host.ops.catalog": {}', "built-in call policy 'host.ops.catalog'"],
  [
    '"document.temporary.status": { admission: "intrinsic" }',
    "intrinsic admission for 'document.temporary.status'",
  ],
])("product assembly refuses %s", async (policy, reason) => {
  const root = mkdtempSync(join(tmpdir(), "pe-product-collision-"));
  try {
    writeAssemblyFixture(
      root,
      fixtureFiles["contract/src/product.ts"].replace(
        /"document.temporary.status": \{ canonicalSession: true \}/,
        policy,
      ),
    );
    await expect(loadFixtureModules(root).load(productAssemblyPaths.actions)).rejects.toThrow(
      `Product @pe/proof-contract cannot declare ${reason}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an authored product folder feeds Host, web and Pea without editing their sources", async () => {
  const root = mkdtempSync(join(tmpdir(), "pe-product-assembly-"));
  try {
    const { assembly, authored, write } = writeAssemblyFixture(root);
    console.log("Fixture authored only " + authored.join(", "));
    const { load } = loadFixtureModules(root);
    const actions = await load<typeof import("@pe/mcps/product-actions")>(
      productAssemblyPaths.actions,
    );
    await expect(load(productAssemblyPaths.catalog).then(() => undefined)).rejects.toThrow(
      `Command ${freshCommand} has no declared catalog axes`,
    );
    const table = "ts/packages/agent-contracts/src/generated/command-axes.generated.ts";
    write(table, commandTableSource(generateCommandTable(actions.hostActions)));
    const { load: loadWithGeneratedTable } = loadFixtureModules(root, join(root, table));
    const catalog = await loadWithGeneratedTable<typeof import("@pe/mcps/product-catalog")>(
      productAssemblyPaths.catalog,
    );
    const contracts = await load<typeof import("@pe/mcps/product-contracts")>(
      productAssemblyPaths.contracts,
    );
    const guides = await load<{ productGuides: readonly { instructions: string }[] }>(
      productAssemblyPaths.guides,
    );
    const tutorial = await load<
      typeof import("../../../apps/web/src/route/tutorial-products.generated.ts")
    >(productAssemblyPaths.tutorial);
    expect(tutorial.tutorialProducts).toMatchObject([
      { id: "proof", homes: { standards: { key: "home-file:proof", rung: 3 } } },
    ]);
    const hostExecutors = await load<
      typeof import("../../../apps/host/src/product-executors.generated.ts")
    >(productAssemblyPaths.executors);
    expect(
      hostExecutors.productReads.flatMap((module) => Object.values(module.reads ?? {})),
    ).toEqual([expect.objectContaining({ name: "proof.echo" })]);
    expect(actions.tools).toHaveProperty("proof");
    expect(actions.commands).toHaveProperty([freshCommand]);
    expect(catalog.linkedCatalog().entries.get(`command:${freshCommand}`)).toMatchObject({
      effect: "Read",
      discovery: { title: freshCommand },
    });
    expect(guides.productGuides).toEqual([{ instructions: "Fixture guide.", skills: [] }]);
    expect(hostExecutors.productExecutors({} as never).executors).toHaveProperty([freshCommand]);
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
    expect(catalog.linkedCatalog().entries.get("document.temporary.status")?.call).toEqual({
      canonicalSession: true,
    });
    expect(
      contracts.resourceReadingSchema.parse({ kind: "proof-reading", text: "fixture" }),
    ).toMatchObject({ text: "fixture" });
    mkdirSync(join(root, "ts/apps/web/src"), { recursive: true });
    expect(routeFolderCandidates(root)).toContain(join(root, product, "web"));
    const web = await load<{ module: { data: { address: string } } }>(product + "web/route.ts");
    expect(web.module.data.address).toBe("/proof");
    expect(assembly.dependencies).toEqual({
      "ts/packages/mcps/package.json": ["@pe/proof-contract"],
      "ts/apps/host/package.json": ["@pe/proof-contract", "@pe/proof-host"],
      "ts/apps/web/package.json": ["@pe/proof-contract", "@pe/proof-web"],
    });

    write(
      product + "contract/package.json",
      JSON.stringify({
        ...contractManifest,
        exports: {},
      }),
    );
    expect(() => renderProductAssembly(root)).toThrow(
      "the contract and the host must both export ./product",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
