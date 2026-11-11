import { expect, test } from "vite-plus/test";
import { linkedCatalog } from "@pe/agent-contracts/pe-api";
import {
  FINDING_KINDS,
  FINDINGS_DOORS,
  findingSchema,
  findingsWork,
  findingsWorkSchema,
  type Finding,
} from "@pe/agent-contracts/slots";
import { subjectCode, uniqueIdSchema, type SubjectRefCode } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import { findingMark, findingsStore } from "./index.ts";

/*
 * Slice 9's red falsifier (routes MAP row 9). Green means: Pea and a person write findings on a
 * fan port and on a /families row into one Work, `list` returns each, an author's undo leaves
 * the other author's, a `note` with a verdict is refused by the contract, one mark draws on the
 * port's captured geometry, and both doors are in the catalog Pea reads (the Pod author's
 * "kernel gap: findings (7)").
 */
const port = subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("9e9fb89e-a9db-4d9a-8f35-b8fbc2303423-00d3da72"), sub: { port: 1 } });
const row = subjectCode({ keyKind: "name", key: ["Price LBP15A Return", "8 X 4 D"] });
const at = "2026-11-10T12:00:00.000Z";
const finding = (id: string, subject: SubjectRefCode, by: Finding["by"], kind: Finding["kind"], verdict?: string): Finding =>
  findingSchema.parse({ id, subject, kind, text: `${by} on ${id}`, by, at, place: { subject }, ...(verdict ? { verdict } : {}) });

test("slice 9: Pea and a person each write a finding on a fan port and a /families row; findings.list returns each; undo leaves the other; a note with a verdict is refused", () => {
  // The contract: a note declares no verdict; the kinds and their verdicts are closed.
  expect(FINDING_KINDS.note).toEqual([]);
  expect(findingSchema.safeParse({ ...finding("n", port, "pea", "note"), verdict: "yes" }).success).toBe(false);
  expect(findingSchema.safeParse({ ...finding("c", port, "pea", "claim"), verdict: "maybe" }).success).toBe(false);
  expect(findingsWork.route).toBe("findings");

  const store = findingsStore(findingsWorkSchema.parse({}));
  store.write(finding("p1", port, "pea", "claim", "no"));
  store.write(finding("h1", row, "person", "claim", "yes"));
  store.write(finding("p2", row, "pea", "note"));
  store.write(finding("h2", port, "person", "check", "pass"));
  expect(store.list().map((f) => f.id)).toEqual(["p1", "h1", "p2", "h2"]);
  expect(store.list(port).map((f) => f.id)).toEqual(["p1", "h2"]);
  expect(store.list(row).map((f) => f.id)).toEqual(["h1", "p2"]);
  store.undo("pea");
  expect(store.list().map((f) => f.id)).toEqual(["p1", "h1", "h2"]);
  store.undo("person");
  expect(store.list().map((f) => f.id)).toEqual(["p1", "h1"]);
  // A semantic command links under `command:` (catalog.ts `commandLink`); bare keys are native ops.
  expect([...linkedCatalog().entries.keys()]).toEqual(
    expect.arrayContaining([`command:${FINDINGS_DOORS.list}`, `command:${FINDINGS_DOORS.write}`]),
  );
});

// Red until slice 8: the fans scene capture carries no SubjectRef per port, so nothing real feeds
// `captured` and `findingMark` throws. Slice 8 (the picture slot) flips this back to test().
test.fails("slice 9: one mark draws on the port's geometry (needs slice 8 Captured SubjectRef per port)", () => {
  const pea = finding("p1", port, "pea", "claim", "no");
  expect(findingMark(pea, [{ ref: port, point: [448.6, 738.7, 1.8] }])).toEqual({
    kind: "ring",
    at: { point: [448.6, 738.7, 1.8] },
  });
});
