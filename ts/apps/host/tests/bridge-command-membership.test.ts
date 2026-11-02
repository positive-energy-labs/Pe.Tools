import { expect, test } from "vite-plus/test";
import { catalogEntries } from "@pe/agent-contracts/pe-api";
import { commandLeafRefusal } from "../src/bridge.ts";

test("nonempty provenance cannot authorize another command's Internal leaf", () => {
  const owner = catalogEntries.find(
    (entry) =>
      entry.key.startsWith("command:") &&
      entry.uses.some((use) =>
        catalogEntries.some(
          (leaf) => leaf.internal && leaf.key === (typeof use === "string" ? use : use.key),
        ),
      ),
  )!;
  expect(owner).toBeDefined();
  const leaf = owner.uses
    .map((use) => (typeof use === "string" ? use : use.key))
    .find((key) => catalogEntries.some((entry) => entry.key === key && entry.internal))!;
  expect(commandLeafRefusal(leaf, owner.key.slice(8))).toBeNull();
  expect(commandLeafRefusal(leaf, "page.publish")).toContain("does not declare");
  expect(commandLeafRefusal(leaf, undefined)).toContain("does not declare");
  expect(commandLeafRefusal("host.ops.catalog", undefined)).toBeNull();
});
