import { expect, test } from "vite-plus/test";

/*
 * Ruling 2026-11-10, verdict 1: no cross-route write. /fans stages no /ducts Work anywhere. It declares
 * no /ducts Work owner (so no cell handle can reach /ducts Work), and its one edit door refuses every
 * /ducts-owned key; a Ledger fix that would stage /ducts Work is a link to /ducts instead
 * (`fans/ledger-fix.journey.test.tsx`). Red at 0e7e4270: Fans owned /ducts Work and edited it.
 */
test("/fans stages no /ducts Work anywhere: no /ducts owner, and its edit door refuses /ducts keys", async () => {
  const { module } = await import("./route.ts");
  const edits = module.spec.edits!;
  expect(Object.keys(edits.owners)).not.toContain("ducts");
  const ducts = {
    kinds: { '["F","T"]': { kind: "erv" } },
    criteria: { healBoxIn: 30 },
    tables: { "elbow-1d": { table: "CD3-1" } },
    assignments: { "Round Elbow": { rule: "elbow-1d" } },
    fittingDrops: { "proposed:a|b": { inWg: 0.1 } },
    joins: [{ pair: ["1:1", "2:1"], verdict: "accept" }],
    ends: [{ end: { elementId: 1, connector: 1 }, verdict: "capped" }],
  };
  for (const [key, value] of Object.entries(ducts))
    expect(edits.input.safeParse({ [key]: value }).success, key).toBe(false);
  // Fans' own cells still pass through the same door.
  expect(edits.input.safeParse({ esp: {} }).success).toBe(true);
});
