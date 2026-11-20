import { expect, test } from "vite-plus/test";
import { bindWork } from "@pe/agent-contracts";
import { commands } from "@pe/mcps/product-actions";
const key = bindWork("pods", null, "contract");
test("Save rejects the retired caller-owned source/hash/raw grammar", () => {
  expect(
    commands["settings.write"].input.safeParse({
      member: { pod: "p", path: "settings/x.json" },
      write: { kind: "create", rawContent: "{}" },
      work: { key, revision: 13 },
    }).success,
  ).toBe(false);
  expect(commands["settings.write"].input.safeParse({ work: { key, revision: 13 } }).success).toBe(
    true,
  );
});
