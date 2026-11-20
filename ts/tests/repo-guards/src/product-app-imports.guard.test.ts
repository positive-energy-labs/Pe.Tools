import { expect, test } from "vite-plus/test";
import { productAppImports } from "./workspace-boundary.ts";

test("product source and manifests depend on shared packages, never apps", () => {
  expect(productAppImports()).toEqual([]);
});
