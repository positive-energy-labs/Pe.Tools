import { expect, test } from "vite-plus/test";
import { productAppImports } from "./product-app-imports.ts";

test("product source and manifests depend on shared packages, never apps", () => {
  expect(productAppImports()).toEqual([]);
});
