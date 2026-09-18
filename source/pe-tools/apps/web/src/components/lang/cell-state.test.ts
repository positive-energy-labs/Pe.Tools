import { describe, expect, it } from "vite-plus/test";

import { cellFromTrichotomy, cellStateLabel } from "./cell-state";

/** The ONE reader's whole contract — the four readings a trichotomy cell can produce. */
describe("cellFromTrichotomy", () => {
  const facts = { value: "150 VA" } as const;

  it("is clean with no proposal and nothing staged", () => {
    const cell = cellFromTrichotomy({ proposal: null, staged: null }, facts);
    expect(cell.stage).toBe("clean");
    expect(cell.stagedBy).toBeUndefined();
    expect(cellStateLabel(cell)).toBe("clean");
  });

  it("is proposed while a proposal stands, and carries its note and confidence", () => {
    const cell = cellFromTrichotomy(
      {
        proposal: {
          value: "150 VA",
          by: "pea",
          note: "from the motor schedule",
          confidence: "low",
        },
      },
      facts,
    );
    expect(cell.stage).toBe("proposed");
    expect(cell.note).toBe("from the motor schedule");
    expect(cell.confidence).toBe("low");
  });

  it("stages in pea's ink when the staged value IS pea's proposal", () => {
    const cell = cellFromTrichotomy(
      { proposal: { value: "150 VA", by: "pea" }, staged: { value: "150 VA" } },
      facts,
    );
    expect(cell.stage).toBe("staged");
    expect(cell.stagedBy).toBe("pea");
  });

  it("stages as yours when the staged value is not what pea proposed", () => {
    const cell = cellFromTrichotomy(
      { proposal: { value: "150 VA", by: "pea" }, staged: { value: "120 VA" } },
      { value: "120 VA" },
    );
    expect(cell.stagedBy).toBe("you");
  });

  it("has no denied reading: clearing the proposal is a clean cell again", () => {
    expect(cellFromTrichotomy({ proposal: null, staged: null }, facts).stage).toBe("clean");
  });

  it("has no written reading: clearing the staging is a clean cell again", () => {
    const committed = cellFromTrichotomy({ proposal: null, staged: null }, { value: "120 VA" });
    expect(cellStateLabel(committed)).toBe("clean");
  });
});

describe("cellFromTrichotomy value equality", () => {
  const facts = { value: "shown" };
  it("treats equal deserialized objects as pea's staged value, not a counter-proposal", () => {
    const cell = cellFromTrichotomy(
      { proposal: { by: "pea", value: { b: 2, a: [1] } }, staged: { value: { a: [1], b: 2 } } },
      facts,
    );
    expect(cell.stagedBy).toBe("pea");
    expect(cell.counterValue).toBeUndefined();
  });
  it("words an object counter through the caller's formatter, and JSON by default", () => {
    const rungs = {
      proposal: { by: "pea" as const, value: { a: 1 } },
      staged: { value: { a: 2 } },
    };
    expect(cellFromTrichotomy(rungs, facts).counterValue).toBe('{"a":1}');
    expect(cellFromTrichotomy(rungs, facts, () => "one").counterValue).toBe("one");
  });
  it("a delete against a set of the same value is a counter-proposal", () => {
    const cell = cellFromTrichotomy(
      { proposal: { by: "pea", value: 1, delete: true } as never, staged: { value: 1 } },
      facts,
    );
    expect(cell.stagedBy).toBe("you");
    expect(cell.counterValue).toBe("delete");
  });
});
