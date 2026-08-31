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

import { ChatSentence } from "#/components/chat-sentence";
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
    { id: "gone", custody: "controlled", phase: "gone", lane: "dev", pid: undefined },
    { id: "failed", custody: "controlled", phase: "failed", lane: "dev", pid: undefined },
  ]);
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
  const session = (startMs: number, title: string): SessionFacts => ({
    sessionId: title,
    sdkSessionId: "same-sdk-id",
    processId: identity.pid,
    processStartUtcUnixMs: startMs,
    lane: "dev",
    custody: "observed",
    activeDocumentTitle: title,
    openDocumentCount: 1,
  });

  const mismatch = fuseFleet([row], [session(2_000, "wrong start")])[0]!;
  expect(mismatch.session).toBeUndefined();
  expect(mismatch.openDocumentCount).toBe(0);

  const match = fuseFleet([row], [session(2_000, "wrong start"), session(1_000, "exact")])[0]!;
  expect(match.session?.activeDocumentTitle).toBe("exact");
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
    return Response.json(url === "/sessions" ? { result: { sessions: [] } } : { sessions: [] });
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
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push(`${init?.method ?? "GET"} ${url}`);
    return Response.json({ sessions: [] });
  };

  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(ChatSentence)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toEqual([]);
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
  }
});
