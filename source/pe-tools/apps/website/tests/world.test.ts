import { expect, test } from "vite-plus/test";
import type { WorkbenchContextBreakdown, WorkbenchContextItem } from "@pe/agent-contracts";
import {
  blastOf,
  cacheTotals,
  computeCacheView,
  orderedLayers,
  signatureMap,
} from "../src/workbench/world-cache.ts";

function breakdown(
  segs: Array<{ id: string; tokens: number; items?: WorkbenchContextItem[] }>,
): WorkbenchContextBreakdown {
  return {
    totalTokens: segs.reduce((sum, s) => sum + s.tokens, 0),
    segments: segs.map((s) => ({ id: s.id, label: s.id, tokens: s.tokens, items: s.items })),
  };
}

const base = breakdown([
  { id: "tools", tokens: 8000 },
  { id: "system-prompt", tokens: 12000 },
  { id: "messages", tokens: 5000 },
  { id: "free", tokens: 900000 },
]);

test("no baseline → every layer is unknown", () => {
  const view = computeCacheView(base, null);
  expect(view.hasBaseline).toBe(false);
  expect(view.horizonRank).toBe(null);
  expect(view.stateOf("system-prompt")).toBe("unknown");
});

test("a messages-only change reprocesses messages but keeps the tools+system prefix cached", () => {
  const next = breakdown([
    { id: "tools", tokens: 8000 },
    { id: "system-prompt", tokens: 12000 },
    { id: "messages", tokens: 5400 }, // grew by one turn
    { id: "free", tokens: 899600 },
  ]);
  const view = computeCacheView(next, signatureMap(base));
  expect(view.horizonRank).toBe(2); // messages
  expect(view.stateOf("tools")).toBe("cached");
  expect(view.stateOf("system-prompt")).toBe("cached");
  expect(view.stateOf("messages")).toBe("reprocessed");
});

test("a system change busts system + everything below, tools prefix survives", () => {
  const next = breakdown([
    { id: "tools", tokens: 8000 },
    { id: "system-prompt", tokens: 12300, items: [{ name: "memory · new fact" }] }, // memory saved
    { id: "messages", tokens: 5400 },
    { id: "free", tokens: 899300 },
  ]);
  const view = computeCacheView(next, signatureMap(base));
  expect(view.horizonRank).toBe(1); // system-prompt
  expect(view.stateOf("tools")).toBe("cached");
  expect(view.stateOf("system-prompt")).toBe("reprocessed");
  expect(view.stateOf("messages")).toBe("reprocessed");
});

test("orderedLayers drops free and sorts by request position", () => {
  expect(orderedLayers(base).map((l) => l.id)).toEqual(["tools", "system-prompt", "messages"]);
});

test("blastOf maps request rank to cache blast radius", () => {
  expect(blastOf(0)).toBe("prefix"); // tools change busts everything
  expect(blastOf(1)).toBe("system"); // system/memory busts system+messages
  expect(blastOf(2)).toBe("free"); // a new message only adds uncached tail
});

test("cacheTotals splits cached vs reprocessed tokens at the horizon", () => {
  const next = breakdown([
    { id: "tools", tokens: 8000 },
    { id: "system-prompt", tokens: 12000 },
    { id: "messages", tokens: 5400 }, // only messages changed
    { id: "free", tokens: 899600 },
  ]);
  const view = computeCacheView(next, signatureMap(base));
  const totals = cacheTotals(orderedLayers(next), view);
  expect(totals.cached).toBe(20000); // tools + system stayed warm
  expect(totals.reprocessed).toBe(5400); // messages reprocessed
});
