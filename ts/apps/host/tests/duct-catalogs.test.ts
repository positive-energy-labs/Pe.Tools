import { mkdir, mkdtemp, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { readDuctCatalogs, productCatalogsRootPath } from "../src/duct-catalogs.ts";
import { productUserContentRootPath } from "../src/product-paths.ts";

const fixture = join(import.meta.dirname, "../../../packages/ducts-domain/src/fixtures/catalogs");
const scratch = join(import.meta.dirname, "../../../../.artifacts/runs/pdrop-catalog/test-roots");

it("reads portable units from a fixture root and resolves production beside Pages without creating it", async () => {
  expect(productCatalogsRootPath()).toBe(join(productUserContentRootPath(), "Catalogs"));
  expect(await readDuctCatalogs(join(scratch, "absent"))).toEqual({ tables: {}, findings: [] });
  const read = await readDuctCatalogs(fixture);
  expect(read.findings).toEqual([]);
  expect(Object.keys(read.tables)).toEqual(["price-lbp-15a"]);
  expect(read.tables["price-lbp-15a"]?.cells.values[7]).toEqual([
    78, 116, 155, 194, 233, 272, 310, 349,
  ]);
});

it("rejects malformed units, duplicate ids and source paths outside the portable unit", async () => {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "catalogs-"));
  await cp(join(fixture, "price-lbp"), join(root, "a"), { recursive: true });
  await cp(join(fixture, "price-lbp"), join(root, "b"), { recursive: true });
  await mkdir(join(root, "broken"));
  await writeFile(join(root, "broken", "catalog.json"), "{}");
  const duplicate = await readDuctCatalogs(root);
  expect(duplicate.tables).toEqual({});
  expect(duplicate.findings).toHaveLength(2);
  const data = JSON.parse(await readFile(join(root, "b", "catalog.json"), "utf8"));
  data.tables[0].id = "escape";
  data.tables[0].source.file = "../a/lbp.pdf";
  await writeFile(join(root, "b", "catalog.json"), JSON.stringify(data));
  const escaped = await readDuctCatalogs(root);
  expect(Object.keys(escaped.tables)).toEqual(["price-lbp-15a"]);
  expect(escaped.findings.join(" ")).toContain("inside its catalog");
});
