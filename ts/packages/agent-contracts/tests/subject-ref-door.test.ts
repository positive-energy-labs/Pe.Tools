import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { decode, subjectCode, uniqueIdSchema } from "@pe/agent-contracts/subject-ref";

// A Pod bundles only what it imports; the barrel drags effect in, so the codec has its own door.
test("the SubjectRef codec has a zod-only subpath door a Pod can bundle", () => {
  const key = uniqueIdSchema.parse("abc-123");
  const code = subjectCode({ keyKind: "UniqueId", key });
  expect(decode(code)).toEqual({ ok: true, value: { keyKind: "UniqueId", key } });
  const imports = readFileSync(new URL("../src/subject-ref.ts", import.meta.url), "utf8").match(/^import .* from "([^"]+)";$/gm) ?? [];
  expect(imports.map((line) => line.replace(/^.* from "([^"]+)";$/, "$1"))).toEqual(["zod"]);
});
