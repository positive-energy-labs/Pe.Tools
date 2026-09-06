// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vite-plus/test";
import type {
  CheckoutReceipt,
  ProcessIdentity,
  SessionObservation,
} from "@pe/host-contracts/pe-revit-contract";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    getRouteApi: () => ({
      useSearch: () => ({}),
      useNavigate: () => () => undefined,
    }),
  };
});

vi.mock("#/workbench/provider", () => ({ useWorkbench: () => ({ revit: false }) }));

import { ChatSentence } from "#/chat/chat-sentence";
import { fuseFleet, useFleet } from "./fleet";
import type { SessionFacts } from "./target";

const observedAtUtc = "2026-08-30T12:00:00.000Z";
const checkoutReceipt: CheckoutReceipt = {
  payload: "checkout",
  buildStamp: "build",
  generationId: "generation",
  generationRoot: "C:\\generation",
  overridePath: null,
  receiptPath: "C:\\session.json",
};
const process = (pid: number, startMs = pid * 1_000): ProcessIdentity => ({
  pid,
  processStartUtc: new Date(startMs).toISOString(),
  executable: "C:\\Revit.exe",
});
const controlled = {
  observedAtUtc,
  origin: "test",
  project: null,
  receipt: checkoutReceipt,
  worktree: "consumer",
  year: 2025,
} as const;

test("beta.132 observations project every fleet case without fallback", () => {
  const journalProcess = process(105);
  const journalFailure: SessionObservation = {
    ...controlled,
    case: "failed-receipt",
    id: "journal-failed",
    detail: "journal failed detail",
    failure: {
      source: "journal",
      event: "crash",
      journalFile: "C:\\journal.txt",
      message: "failed",
      process: journalProcess,
    },
  };
  const rows: SessionObservation[] = [
    {
      ...controlled,
      case: "controlled-active",
      id: "ready",
      detail: "ready detail",
      process: process(101),
      bridge: { bridge: "ready", sessionDescriptor: "C:\\session.json" },
    },
    {
      ...controlled,
      case: "controlled-pending",
      id: "pending",
      detail: "pending detail",
      attempt: {
        attempt: "launched",
        process: process(102),
        bridge: { bridge: "missing-endpoint" },
      },
    },
    {
      case: "observed-active",
      observedAtUtc,
      year: 2025,
      process: process(201),
      bridge: { bridge: "answering", sessionDescriptor: null },
    },
    {
      case: "observed-active",
      observedAtUtc,
      year: 2025,
      process: process(202),
      bridge: { bridge: "missing-endpoint" },
    },
    {
      case: "observed-active",
      observedAtUtc,
      year: 2025,
      process: process(203),
      bridge: { bridge: "unresponsive-endpoint" },
    },
    {
      ...controlled,
      case: "gone-receipt",
      id: "gone",
      detail: "gone detail",
      process: process(104),
    },
    {
      ...controlled,
      case: "failed-receipt",
      id: "failed",
      detail: "failed detail",
      failure: {
        source: "receipt",
        failure: { atUtc: observedAtUtc, code: "session.failed", detail: "failed detail" },
      },
    },
    journalFailure,
  ];

  expect(
    fuseFleet(rows, []).map(({ id, custody, phase, lane, pid }) => ({
      id,
      custody,
      phase,
      lane,
      pid,
    })),
  ).toEqual([
    { id: "ready", custody: "controlled", phase: "ready", lane: "dev", pid: 101 },
    { id: "pending", custody: "controlled", phase: "booting", lane: "dev", pid: 102 },
    { id: "201", custody: "observed", phase: "ready", lane: undefined, pid: 201 },
    { id: "202", custody: "observed", phase: "unresponsive", lane: undefined, pid: 202 },
    { id: "203", custody: "observed", phase: "unresponsive", lane: undefined, pid: 203 },
    { id: "gone", custody: "controlled", phase: "gone", lane: "dev", pid: 104 },
    { id: "failed", custody: "controlled", phase: "failed", lane: "dev", pid: undefined },
    { id: "journal-failed", custody: "controlled", phase: "failed", lane: "dev", pid: 105 },
  ]);

  const journalSession: SessionFacts = {
    sessionId: "journal-bridge",
    processId: journalProcess.pid,
    processStartUtcUnixMs: Date.parse(journalProcess.processStartUtc),
    lane: "dev",
    custody: "controlled",
    openDocumentCount: 0,
  };
  expect(fuseFleet([journalFailure], [journalSession])[0]?.session).toBe(journalSession);
});

test("fleet fusion requires equal pid and process start", () => {
  const identity = process(4128, 1_000);
  const row: SessionObservation = {
    case: "observed-active",
    observedAtUtc,
    year: 2025,
    process: identity,
    bridge: { bridge: "answering", sessionDescriptor: null },
  };
  const storedSession: SessionFacts = {
    sessionId: "bridge-user",
    sdkSessionId: "same-sdk-id",
    processId: identity.pid,
    processStartUtcUnixMs: 2_000,
    lane: "dev",
    custody: "controlled",
    activeDocumentTitle: "connected document",
    openDocumentCount: 1,
  };

  expect(fuseFleet([], [storedSession])).toEqual([
    {
      id: "bridge-user",
      custody: "observed",
      phase: "ready",
      detail: "Host bridge is connected, but no exact SDK census row matched.",
      lane: "dev",
      pid: identity.pid,
      session: storedSession,
    },
  ]);

  const mismatch = fuseFleet([row], [storedSession]);
  expect(mismatch.map(({ id, custody, session }) => ({ id, custody, session }))).toEqual([
    { id: String(identity.pid), custody: "observed", session: undefined },
    { id: "bridge-user", custody: "observed", session: storedSession },
  ]);

  const exactSession = { ...storedSession, sessionId: "exact", processStartUtcUnixMs: 1_000 };
  const match = fuseFleet([row], [exactSession]);
  expect(match).toHaveLength(1);
  expect(match[0]?.session).toBe(exactSession);

  expect(fuseFleet([row, row], [exactSession]).map((world) => world.session?.sessionId)).toEqual([
    "exact",
    undefined,
  ]);
});

function FleetProbe({ enabled }: { enabled: boolean }) {
  useFleet({ enabled });
  return null;
}

test("capability admission gates every fleet request", async () => {
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push(`${init?.method ?? "GET"} ${url}`);
    return Response.json(
      url === "/sessions"
        ? {
            result: {
              processReadErrors: [],
              registryRoot: "C:\\registry",
              sessions: [],
              state: "no-sessions",
              unreadableReceipts: [],
            },
          }
        : { sessions: [] },
    );
  };
  const mount = (enabled: boolean) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      createElement(QueryClientProvider, { client }, createElement(FleetProbe, { enabled })),
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

test("mounted chat makes no session or bridge requests without Revit capability", async () => {
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  // jsdom has no EventSource; the thread Scope watch is host-owned and opens without Revit.
  const originalEventSource = (globalThis as { EventSource?: unknown }).EventSource;
  (globalThis as { EventSource?: unknown }).EventSource = class {
    onmessage: unknown = null;
    close() {}
  };
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push(`${init?.method ?? "GET"} ${url}`);
    return Response.json({ sessions: [] });
  };

  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      createElement(QueryClientProvider, { client }, createElement(ChatSentence, { name: "Chat" })),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests.filter((request) => /\/(sessions|call)(?:\?|$)/.test(request))).toEqual([]);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    (globalThis as { EventSource?: unknown }).EventSource = originalEventSource;
  }
});
