import { expect, test } from "vite-plus/test";
import { machineFileHandle, ownerBlob } from "@pe/agent-contracts/product";
import { product } from "../product.ts";

test("Rooms declares its C# record and trace homes", () => {
  expect(product.homes.regions.key).toMatch(/^owner-blob:[0-9a-f-]{36}$/i);
  expect(product.homes.regions.key).toBe(ownerBlob("regionRecord").key);
  expect(product.homes.traces.key).toBe(machineFileHandle("runTraces").key);
  expect(product.homes.traces.key).toBe("machine-file:rooms");
});

test("Takeoffs setup and adoption declare the carrier homes they touch", () => {
  expect(product.homes.registry.key).toBe(ownerBlob("takeoffRegistry").key);
  expect(product.homes.enclosure.key).toBe(ownerBlob("partitionEnclosure").key);
  expect(product.commands["takeoffs.initialize"].writes).toEqual({ registry: [], enclosure: [] });
  expect(product.commands["takeoffs.adopt"].writes).toEqual({
    regions: [],
    registry: [],
    enclosure: [],
  });
});
