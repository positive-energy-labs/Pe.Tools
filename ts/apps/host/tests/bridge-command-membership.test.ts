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

import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { readFileSync } from "node:fs";
import { requireEligibleCaller } from "../src/gateway-actions.ts";
import { pea } from "./callers.ts";
test("every advertised native preview admits a direct Pea call and agrees with C# metadata", () => {
  const source = readFileSync(new URL("../../../../dotnet/Pe.Revit.Global/Services/Host/RevitDataRequestService.cs", import.meta.url), "utf8");
  const previews = hostOpCatalog.filter(op => op.key.endsWith(".preview"));
  expect(previews.length).toBe(4);
  for (const op of previews) {
    expect(op.effect, op.key).toBe("TransactRead");
    expect(op.rollsBack, op.key).toBe(true);
    expect(op.intent, op.key).toBe("Read");
    expect(op.internal, op.key).toBe(false);
    expect(commandLeafRefusal(op.key, undefined)).toBeNull();
    expect(() => requireEligibleCaller({ ...op, principal: ["human", "pea"] }, pea(), "/call")).not.toThrow();
    const declaration = source.split("\n").find(line => line.includes(`[Op("${op.key}"`))!;
    expect(declaration, op.key).not.toContain("Internal = true");
    expect(declaration, op.key).toContain("RollsBack = true");
  }
});
