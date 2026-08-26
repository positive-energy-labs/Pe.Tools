// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { createElement } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { sentenceText } from "../src/components/chat-sentence";
import { Sentence } from "../src/components/sentence";
import { fuseFleet, worldClause, type SessionRow } from "../src/host/fleet";
import type { SessionFacts } from "../src/host/target";

const NOW = Date.parse("2026-07-16T12:00:00Z");

const zero = { proposals: 0, staged: 0, good: 0, attention: 0 };

test("chat fleet capability gates every Revit fetch", async () => {
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push(`${init?.method ?? "GET"} ${url}`);
    return Response.json(url === "/sessions" ? { result: { sessions: [] } } : { sessions: [] });
  };
  const mount = (enabled: boolean) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Sentence, {
          prefix: "Pea is ready",
          target: "observed",
          onBind: () => undefined,
          fleetEnabled: enabled,
        }),
      ),
    );
  };

  try {
    const disabled = mount(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toEqual([]);
    disabled.unmount();

    mount(true);
    await waitFor(() => expect(requests.sort()).toEqual(["GET /sessions", "POST /call"]));
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});

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
  lane: "installed",
  custody: "controlled",
  sdkSessionId: "sbx-a",
  openDocumentCount: 1,
  ...over,
});

/** A `pe-revit session status` row, with only the fields the fusion actually reads set. */
const row = (over: Partial<SessionRow>): SessionRow =>
  ({
    id: "sbx-a",
    custody: "controlled",
    phase: "ready",
    state: "ready",
    detail: "",
    lane: "installed",
    origin: "cli",
    legs: [],
    documents: null,
    activeDocument: null,
    observedAtUtc: "2026-07-16T12:00:00Z",
    pid: null,
    year: null,
    ...over,
  }) as SessionRow;

test("fleet fusion: status rows are the fleet, a bridge session joins its own row; world clause speaks phases", () => {
  const rows: SessionRow[] = [
    row({ id: "sbx-a", phase: "ready", state: "ready" }), // bridge-connected — must not double
    row({ id: "sbx-b", phase: "booting", state: "booting", year: "26" }),
    row({ id: "sbx-c", phase: "gone", state: "dead" }),
  ];
  const worlds = fuseFleet(rows, [session({})]);
  expect(worlds.map((world) => [world.id, world.phase])).toEqual([
    ["sbx-a", "ready"],
    ["sbx-b", "booting"],
    ["sbx-c", "gone"],
  ]);
  // The bridge session joined sbx-a by its reported pe-revit session id; it did not become a
  // fourth world. That de-duplication is the whole point of the join key.
  expect(worlds.filter((world) => world.session).map((world) => world.id)).toEqual(["sbx-a"]);

  expect(worldClause(worlds, "session:sbx-a")).toBe(" in a live world (sbx-a)");
  expect(worldClause(worlds, "session:sbx-b")).toBe(" in a world that is still booting");
  expect(worldClause(worlds, "session:sbx-c")).toBe(" — its world is gone");
  expect(worldClause(fuseFleet([], []), "observed")).toBe(" — no world is running");
});

test("a bridge session with no status row stands alone as its own world", () => {
  // The user's own Revit: connected to the bridge, absent from the pe-revit registry.
  const yours = session({ sessionId: "s2", custody: "observed", sdkSessionId: undefined });
  const worlds = fuseFleet([], [yours]);
  expect(worlds).toHaveLength(1);
  expect(worlds[0]).toMatchObject({ id: "s2", custody: "observed", phase: "ready" });
});
