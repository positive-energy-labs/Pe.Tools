import { expect, test } from "vite-plus/test";
import { linkedCatalog } from "@pe/agent-contracts/pe-api";
import { commandLeafRefusal } from "../src/bridge.ts";

test("nonempty provenance cannot authorize another command's Internal leaf", () => {
  const catalog = linkedCatalog().entries;
  const owner = [...catalog.values()].find(
    (entry) =>
      entry.key.startsWith("command:") &&
      entry.uses.some((use) =>
        catalog.get(typeof use === "string" ? use : use.key)?.internal,
      ),
  )!;
  expect(owner).toBeDefined();
  const leaf = owner.uses
    .map((use) => (typeof use === "string" ? use : use.key))
    .find((key) => catalog.get(key)?.internal)!;
  expect(commandLeafRefusal(leaf, owner.key.slice(8))).toBeNull();
  expect(commandLeafRefusal(leaf, "page.publish")).toContain("does not declare");
  expect(commandLeafRefusal(leaf, undefined)).toContain("does not declare");
  expect(commandLeafRefusal("host.ops.catalog", undefined)).toBeNull();
});

import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { requireEligibleCaller } from "../src/gateway-actions.ts";
import { pea } from "./callers.ts";
test("every advertised native preview admits a direct Pea call and agrees with C# metadata", () => {
  const previews = hostOpCatalog.filter(op => op.key.endsWith(".preview"));
  // ducts.apply.preview became the Read ducts.apply.plan (V1, 0d237121).
  expect(previews.map(op => op.key).sort()).toEqual([
    "ducts.assign-fan.preview",
    "ducts.heal.preview",
    "revit.apply.parameter-links.preview",
  ]);
  for (const op of previews) {
    expect(op.effect, op.key).toBe("TransactRead");
    expect(op.rollsBack, op.key).toBe(true);
    expect(op.intent, op.key).toBe("Read");
    expect(op.internal, op.key).toBe(false);
    expect(commandLeafRefusal(op.key, undefined)).toBeNull();
    expect(() => requireEligibleCaller({ ...op, principal: ["human", "pea"] }, pea(), "/call")).not.toThrow();
  }
});
