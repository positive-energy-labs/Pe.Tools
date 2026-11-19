import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { linkedCatalog } from "@pe/mcps/product-catalog";
import { FINDING_KINDS, FINDINGS_DOORS, findingSchema, findingsWork, type Finding } from "@pe/agent-contracts/slots";
import { subjectCode, uniqueIdSchema } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import { findingMark, kernelVerbs } from "./index.ts";

/*
 * Slice 9's web half (routes MAP row 9): a `note` with a verdict has no shape, one mark draws on
 * the port's captured geometry, every door is in the catalog Pea reads, and the kernel verb table
 * names the three write doors. The doors themselves are proven in apps/host/tests/findings.test.ts.
 */
const port = subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("9e9fb89e-a9db-4d9a-8f35-b8fbc2303423-00d3da72"), sub: { port: 1 } });
const said = { by: "pea", at: "2026-11-10T12:00:00.000Z" } as const;
const claim: Finding = { id: "p1", subject: port, kind: "claim", text: "pea on p1", said, verdict: { ...said, value: "no" } };

test.each(["families/matrix.tsx", "families/pivot-grid.tsx", "../../../products/fans/web/src/mount.tsx", "../../../products/duct-systems/web/src/screen/screen.tsx", "../../../products/fans/web/src/calc/view.tsx"])("%s never mounts finding verbs or pointer citations", path => {
    const source = readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
    expect(source, path).not.toMatch(/route\/slots\/findings|FindingVerb|PointerCite|pointerRefs/);
});

test("slice 9: a note with a verdict is refused; every door is in the catalog Pea reads; the kernel verbs are the write doors", () => {
  // The contract: a note has no verdict key; the kinds and their verdicts are closed.
  expect(FINDING_KINDS.note).toEqual([]);
  expect(findingSchema.safeParse(claim).success).toBe(true);
  expect(findingSchema.safeParse({ ...claim, kind: "note" }).success).toBe(false);
  expect(findingSchema.safeParse({ ...claim, verdict: { ...said, value: "maybe" } }).success).toBe(false);
  expect(findingsWork.route).toBe("findings");

  // A semantic command links under `command:` (catalog.ts `commandLink`); bare keys are native ops.
  expect([...linkedCatalog().entries.keys()]).toEqual(
    expect.arrayContaining(Object.values(FINDINGS_DOORS).map((door) => `command:${door}`)),
  );
  const { list: _list, ...writes } = FINDINGS_DOORS;
  expect(Object.entries(kernelVerbs).map(([key, verb]) => [key, verb.handle.key])).toEqual(Object.values(writes).map((door) => [door, door]));
});

test("slice 9: one mark draws on the port's geometry", () => {
  expect(findingMark(claim, [{ ref: port, point: [448.6, 738.7, 1.8] }])).toEqual({
    kind: "ring",
    at: { point: [448.6, 738.7, 1.8] },
  });
});
