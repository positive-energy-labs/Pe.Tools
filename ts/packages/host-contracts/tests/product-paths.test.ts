import { expect, test } from "vite-plus/test";
import { productPathNames } from "../src/contracts/product.ts";
import { productHomePath, testHomeRootVariable } from "../src/product-paths.ts";

const homeVariable = productPathNames.productHomeVariable;

test("under a test run no product home may resolve outside the temp directory", () => {
  const original = process.env[homeVariable];
  try {
    expect(process.env[testHomeRootVariable]).toBeTruthy();
    process.env[homeVariable] = "C:UserssomeoneDocumentsPe.Tools";
    expect(() => productHomePath()).toThrow("Test isolation");
    delete process.env[homeVariable];
    expect(() => productHomePath()).toThrow("PE_TOOLS_SHARED_ROOT");
  } finally {
    if (original === undefined) delete process.env[homeVariable];
    else process.env[homeVariable] = original;
  }
});
