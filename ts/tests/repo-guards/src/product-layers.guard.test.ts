import { expect, test } from "vite-plus/test";
import { productLayerViolations, productSources } from "./product-layers.ts";

test("product imports obey the layer ruling without an allowlist", () => {
  expect(productLayerViolations(productSources())).toEqual([]);
});

for (const [from, spec, fails] of [
  ["fans/web", "@pe/duct-systems-web/route", true],
  ["fans/domain", "@pe/fans-host/actions", true],
  ["duct-systems/web", "@pe/ducts-web/airflow", false],
  ["fans/web", "@pe/duct-systems-contract/contract", false],
  ["fans/domain", "../../host/src/actions", true],
  ["fans/web", "../../../duct-systems/web/route", true],
  ["fans/domain", "@pe/ducts-web/design-calc", true],
  ["fans/web", "@pe/ducts-domain/types", false],
  ["fans/web", "@pe/ducts-web/src/private", true],
  ["fans/web", "../../../ducts/web/src/design-calc", true],
] as const) {
  for (const statement of [
    `import * as x from "${spec}";`,
    `export * from "${spec}";`,
    `const x = import("${spec}");`,
  ]) test(`${from}: ${statement}`, () => {
    const file = `products/${from}/src/planted.ts`;
    expect(productLayerViolations({ [file]: statement })).toEqual(fails ? [`${file} -> ${spec}`] : []);
  });
}

test("web may import the shared base domain", () => {
  expect(productLayerViolations({ "products/fans/web/src/planted.ts":
    'import { x } from "@pe/ducts-domain/types";' })).toEqual([]);
});

test("the shared base domain may not import a product domain", () => {
  const file = "products/ducts/domain/src/planted.ts";
  const spec = "@pe/fans-domain/calc/network-calcs";
  expect(productLayerViolations({ [file]: `import { x } from "${spec}";` })).toEqual([`${file} -> ${spec}`]);
});
