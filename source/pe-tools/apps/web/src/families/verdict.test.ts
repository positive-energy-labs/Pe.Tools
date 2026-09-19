/**
 * 21 break 3: receipts and plan rows key by family NAME. Revit reissues every applied family's id
 * on reload, so a receipt (or plan row) keyed by id finds nothing on the reading that follows.
 */
import { expect, test } from "vite-plus/test";
import type { FfReceipt } from "@pe/agent-contracts";

import { familyVerdicts } from "./verdict";

const receipt = (familyId: number, familyName: string): FfReceipt => ({
  familyId,
  familyName,
  success: true,
  converged: true,
  error: null,
  planHash: "p",
  residue: [],
  errors: [],
  artifactDirectory: null,
});

/** A matrix row as the current reading draws it: its id is a display fact of that reading. */
const row = (familyId: number, familyName: string) => ({ familyId, familyName });

test("a receipt keyed by name renders against a reading whose ids changed", () => {
  // Applied as id 101; the reading after the reload names "Alpha" as id 202.
  const verdict = familyVerdicts(null, [receipt(101, "Alpha")], new Set());
  expect(verdict(row(202, "Alpha")).word).toBe("converged");
  expect(verdict(row(101, "Beta")).word).toBe("unplanned");
});

test("a plan row and an exclusion find their family by name", () => {
  const plan = {
    entries: [
      {
        id: "Alpha",
        name: "Alpha",
        planHash: "p",
        actions: 2,
        detail: "",
        flag: null,
        warnings: [],
      },
      { id: "Beta", name: "Beta", planHash: "q", actions: 1, detail: "", flag: null, warnings: [] },
    ],
  };
  const verdict = familyVerdicts(plan, [], new Set(["Beta"]));
  expect(verdict(row(7, "Alpha")).word).toBe("included");
  expect(verdict(row(8, "Beta")).word).toBe("excluded");
});
