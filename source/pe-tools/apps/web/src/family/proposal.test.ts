/**
 * THE ONE PROPOSAL LIFECYCLE, as family speaks it (ruled 2026-08-31, proposal-state demiurge).
 *
 * Family's `ProposalVerdict` / `CellVerdict` are deleted; every reading of a proposal now comes
 * out of `proposalCell` → `cellFromTrichotomy`, the shared reader. These are the four readings
 * that machine can produce, plus the two absences that make it ONE machine rather than two.
 */
import { describe, expect, it } from "vite-plus/test";
import { cellFromTrichotomy, cellStateLabel } from "#/components/lang/cell";
import { proposalCell } from "#/family/model";
import type { ProtoProposal } from "#/family/world";

const PROPOSAL: ProtoProposal = {
  id: "p3",
  param: "Voltage",
  current: "240 V",
  proposed: "277 V",
  sourceBlockId: "b5",
  confidence: "low",
  note: "the cut sheet says 277 V",
};

const read = (proposals: ProtoProposal[], staged: string | null, value: string) =>
  cellFromTrichotomy(proposalCell(proposals, staged), { value });

describe("family's proposal cell", () => {
  it("a standing proposal is PROPOSED, and carries pea's note and confidence", () => {
    const cell = read([PROPOSAL], null, "240 V");
    expect(cell.stage).toBe("proposed");
    expect(cell.stagedBy).toBeUndefined();
    expect(cell.note).toBe("the cut sheet says 277 V");
    expect(cell.confidence).toBe("low");
    expect(cellStateLabel(cell)).toBe("proposed");
  });

  it("accept stages pea's value, and the square is derived as PEA's", () => {
    // Accept writes the proposed value into the draft and leaves the proposal STANDING — that
    // standing proposal is the only evidence the staged value is pea's rather than yours.
    const cell = read([PROPOSAL], "277 V", "277 V");
    expect(cell.stage).toBe("staged");
    expect(cell.stagedBy).toBe("pea");
  });

  it("deny CLEARS the proposal — the cell shows the real value and draws nothing", () => {
    const cell = read([], null, "240 V");
    expect(cell.stage).toBe("clean");
    expect(cell.value).toBe("240 V");
    expect(cellStateLabel(cell)).toBe("clean");
  });

  it("typing your own value clears it too, and the square is YOURS", () => {
    // What `superseded` used to name. It is the same outcome as a denial — the proposal is gone —
    // and the staged value is yours because no proposal stands behind it arguing for that number.
    const cell = read([], "208 V", "208 V");
    expect(cell.stage).toBe("staged");
    expect(cell.stagedBy).toBe("you");
  });

  it("has no denied and no superseded reading anywhere", () => {
    for (const cell of [
      read([PROPOSAL], null, "240 V"),
      read([PROPOSAL], "277 V", "277 V"),
      read([], null, "240 V"),
      read([], "208 V", "208 V"),
    ]) {
      expect(cellStateLabel(cell)).not.toBe("denied");
      expect(cellStateLabel(cell)).not.toBe("superseded");
      expect(Object.keys(cell)).not.toContain("verdict");
    }
  });
});
