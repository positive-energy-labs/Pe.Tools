import { expect, test } from "vite-plus/test";
import { machineFileHandle, ownerBlob } from "@pe/agent-contracts/product";
import { product } from "../product.ts";

test("Rooms declares its C# record and trace homes", () => {
  expect(product.homes.regions.key).toMatch(/^owner-blob:[0-9a-f-]{36}$/i);
  expect(product.homes.regions.key).toBe(ownerBlob("regionRecord").key);
  expect(product.homes.traces.key).toBe(machineFileHandle("runTraces").key);
  expect(product.homes.traces.key).toBe("machine-file:rooms");
});
