import { expect, test } from "vite-plus/test";
import { linkedCatalog } from "@pe/agent-contracts/pe-api";
import {
  FINDING_KINDS,
  FINDINGS_DOORS,
  findingSchema,
  findingsWork,
  type Finding,
} from "@pe/agent-contracts/slots";
import { subjectCode, uniqueIdSchema, type SubjectRefCode } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import { findingMark } from "./index.ts";

/*
 * Slice 9's web half (routes MAP row 9): a `note` with a verdict is refused by the contract, one
 * mark draws on the port's captured geometry, and both doors are in the catalog Pea reads (the Pod
 * author's "kernel gap: findings (7)"). Writes, list and per-author undo are proven through the
 * host's doors in apps/host/tests/findings.test.ts.
 */
const port = subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse("9e9fb89e-a9db-4d9a-8f35-b8fbc2303423-00d3da72"), sub: { port: 1 } });
const at = "2026-11-10T12:00:00.000Z";
const finding = (id: string, subject: SubjectRefCode, by: Finding["by"], kind: Finding["kind"], verdict?: string): Finding =>
  findingSchema.parse({ id, subject, kind, text: `${by} on ${id}`, by, at, place: { subject }, ...(verdict ? { verdict } : {}) });

test("slice 9: a note with a verdict is refused; both doors are in the catalog Pea reads", () => {
  // The contract: a note declares no verdict; the kinds and their verdicts are closed.
  expect(FINDING_KINDS.note).toEqual([]);
  expect(findingSchema.safeParse({ ...finding("n", port, "pea", "note"), verdict: "yes" }).success).toBe(false);
  expect(findingSchema.safeParse({ ...finding("c", port, "pea", "claim"), verdict: "maybe" }).success).toBe(false);
  expect(findingsWork.route).toBe("findings");

  // A semantic command links under `command:` (catalog.ts `commandLink`); bare keys are native ops.
  expect([...linkedCatalog().entries.keys()]).toEqual(
    expect.arrayContaining([`command:${FINDINGS_DOORS.list}`, `command:${FINDINGS_DOORS.write}`]),
  );
});

test("slice 9: one mark draws on the port's geometry", () => {
  const pea = finding("p1", port, "pea", "claim", "no");
  expect(findingMark(pea, [{ ref: port, point: [448.6, 738.7, 1.8] }])).toEqual({
    kind: "ring",
    at: { point: [448.6, 738.7, 1.8] },
  });
});
