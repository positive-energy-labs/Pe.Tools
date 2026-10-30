import { expect, test } from "vite-plus/test";
import { bindWork, commands } from "@pe/agent-contracts";
const key = bindWork("family", null, "contract");
test("optional Family observation accepts exact source evidence", () => {
  const source = { pod: "p", path: "settings/x.json", sha256: "a".repeat(64) };
  expect(commands["family.observe"].input.safeParse({}).success).toBe(false);
  expect(commands["family.observe"].input.safeParse({ readingId: "r", source }).success).toBe(
    false,
  );
  expect(commands["family.observe"].input.safeParse({ source }).success).toBe(true);
  expect(commands["family.observe"].input.safeParse({ readingId: "capture-r" }).success).toBe(true);
});
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
