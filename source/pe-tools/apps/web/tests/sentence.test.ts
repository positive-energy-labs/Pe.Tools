import { expect, test } from "vite-plus/test";

import { sentenceText } from "../src/components/chat-sentence";
import { fuseFleet, worldClause, type SandboxRegistryEntry } from "../src/host/fleet";
import type { SessionFacts } from "../src/host/target";

const NOW = Date.parse("2026-07-16T12:00:00Z");

const zero = { proposals: 0, staged: 0, good: 0, attention: 0 };

test("sentence grammar over the run lifecycle: idle → working → awaiting → committed → failed", () => {
  expect(
    sentenceText({ snapshot: { phase: "idle" }, clause: "", staged: null, nowMs: NOW }),
  ).toEqual({
    text: "pea is idle — nothing in flight",
    tone: "rest",
  });

  expect(
    sentenceText({
      snapshot: {
        phase: "working",
        activity: { verb: "navigating", gerund: "opening", target: "apply.document.open" },
      },
      clause: " in a live world (sbx-1)",
      staged: null,
      nowMs: NOW,
    }),
  ).toEqual({
    text: "pea is opening apply.document.open in a live world (sbx-1)",
    tone: "active",
  });

  expect(
    sentenceText({
      snapshot: { phase: "idle" },
      clause: "",
      staged: { ...zero, proposals: 2, staged: 1 },
      nowMs: NOW,
    }),
  ).toEqual({ text: "pea is waiting on your review — 2 proposed, 1 staged", tone: "awaiting" });

  const committed = sentenceText({
    snapshot: {
      phase: "idle",
      lastCompleted: {
        activity: { verb: "editing", gerund: "editing", target: "family" },
        isError: false,
        completedAt: new Date(NOW - 1000).toISOString(),
      },
    },
    clause: "",
    staged: zero,
    nowMs: NOW,
  });
  expect(committed).toEqual({ text: "finished editing family · just now", tone: "committed" });

  const failed = sentenceText({
    snapshot: {
      phase: "idle",
      lastCompleted: {
        activity: { verb: "scripting", gerund: "scripting" },
        isError: true,
        completedAt: new Date(NOW - 1000).toISOString(),
      },
    },
    clause: "",
    staged: null,
    nowMs: NOW,
  });
  expect(failed).toEqual({ text: "ran into trouble scripting", tone: "failed" });

  // relax: the same failure ten seconds later reads as rest again
  expect(
    sentenceText({
      snapshot: failedSnapshotAt(NOW - 10_000),
      clause: "",
      staged: null,
      nowMs: NOW,
    }).tone,
  ).toBe("rest");
});

function failedSnapshotAt(completedMs: number) {
  return {
    phase: "idle" as const,
    lastCompleted: {
      activity: { verb: "scripting" as const, gerund: "scripting" },
      isError: true,
      completedAt: new Date(completedMs).toISOString(),
    },
  };
}

const session = (over: Partial<SessionFacts>): SessionFacts => ({
  sessionId: "s1",
  processId: 100,
  lane: "sandbox",
  sandboxId: "sbx-a",
  openDocumentCount: 1,
  ...over,
});

test("fleet fusion: bridge sessions win, registry fills boot/death; world clause speaks phases", () => {
  const registry: SandboxRegistryEntry[] = [
    { id: "sbx-a", state: "ready" }, // bridge-connected — must not double
    { id: "sbx-b", state: "booting", year: "26" },
    { id: "sbx-c", state: "dead" },
  ];
  const worlds = fuseFleet([session({})], registry);
  expect(worlds.map((world) => [world.id, world.phase])).toEqual([
    ["sbx-a", "live"],
    ["sbx-b", "booting"],
    ["sbx-c", "dead"],
  ]);

  expect(worldClause(worlds, "sandbox:sbx-a")).toBe(" in a live world (sbx-a)");
  expect(worldClause(worlds, "sandbox:sbx-b")).toBe(" in a world that is still booting");
  expect(worldClause(worlds, "sandbox:sbx-c")).toBe(" — its world is gone");
  expect(worldClause(fuseFleet([], []), "user")).toBe(" — no world is running");
});
