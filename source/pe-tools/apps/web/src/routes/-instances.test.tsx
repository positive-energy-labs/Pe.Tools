// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { useFleet, WorldFacts } from "#/host/fleet";

const fleet = vi.hoisted(() => {
  const value: ReturnType<typeof useFleet> = {
    worlds: [
      {
        id: "pe.app-25",
        custody: "controlled",
        phase: "ready",
        detail: "ready detail",
        pid: 25,
        row: {
          case: "controlled-active",
          bridge: { bridge: "ready", sessionDescriptor: "C:\\session.json" },
          detail: "ready detail",
          id: "pe.app-25",
          observedAtUtc: "2026-08-30T12:00:00.000Z",
          origin: "test",
          process: {
            executable: "C:\\Revit.exe",
            pid: 25,
            processStartUtc: "2026-08-30T11:59:00.000Z",
          },
          project: null,
          receipt: {
            payload: "checkout",
            buildStamp: "build",
            generationId: "generation",
            generationRoot: "C:\\generation",
            overridePath: null,
            receiptPath: "C:\\session.json",
          },
          worktree: "consumer",
          year: 2025,
        },
      },
      {
        id: "installed-25",
        custody: "controlled",
        phase: "failed",
        detail: "failed detail",
        row: {
          case: "failed-receipt",
          detail: "failed detail",
          failure: {
            source: "receipt",
            failure: {
              atUtc: "2026-08-30T12:00:00.000Z",
              code: "session.failed",
              detail: "failed detail",
            },
          },
          id: "installed-25",
          observedAtUtc: "2026-08-30T12:00:00.000Z",
          origin: "test",
          project: null,
          receipt: {
            payload: "installed",
            generationRoot: "C:\\generation",
            receiptPath: "C:\\session.json",
          },
          worktree: "consumer",
          year: 2025,
        },
      },
    ],
    sessions: [],
    unreadableReceipts: [],
    processReadErrors: [],
    registryRoot: "C:\\registry",
    isLoading: false,
    stale: false,
    error: null,
    at: 123,
    basis: ["sessions.list", "bridge.sessions.list"],
  };
  return { value, useFleet: vi.fn(() => value) };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (options: object) => ({
      ...options,
      useSearch: () => ({ target: "", stage: "declare" as const }),
    }),
    useNavigate: () => () => Promise.resolve(),
    useRouter: () => ({ navigate: () => Promise.resolve() }),
    useLocation: (options?: { select?: (location: { href: string }) => unknown }) =>
      options?.select?.({ href: "/instances" }) ?? { href: "/instances" },
    useSearch: () => ({}),
  };
});

vi.mock("#/host/fleet", () => fleet);

vi.mock("#/host/use-target", () => ({ useWorldLog: () => [] }));
vi.mock("#/host/queries", () => ({ HOST_QUERY_KEY: ["host"] }));

import { InstancesPage } from "#/routes/instances";
import { paneState } from "#/targeting/kit";
import { product as defineProduct } from "#/targeting/model";
import { worldTrunk } from "#/targeting/world";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("instances route", () => {
  it("does not enable a default fleet query beside the all-session query", () => {
    fleet.useFleet.mockClear();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <InstancesPage />
      </QueryClientProvider>,
    );

    expect(fleet.useFleet.mock.calls).toEqual([[{ all: true }], [{ enabled: false }]]);
  });

  it("asks for a document before mounting the route document", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InstancesPage />
      </QueryClientProvider>,
    );

    expect(screen.getByText("pick a document")).toBeTruthy();
  });

  it("discloses census exceptions when no session identity can be formed", () => {
    fleet.useFleet.mockReturnValueOnce({
      ...fleet.value,
      worlds: [],
      sessions: [],
      unreadableReceipts: [
        {
          detail: "receipt JSON could not be decoded",
          id: "broken-receipt",
          observedAtUtc: "2026-08-30T12:00:00.000Z",
          receiptPath: "C:\\registry\\broken.json",
        },
      ],
      processReadErrors: [
        {
          candidatePid: 404,
          detail: "process start time was unavailable",
          observedAtUtc: "2026-08-30T12:00:00.000Z",
        },
      ],
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <InstancesPage />
      </QueryClientProvider>,
    );

    const disclosure = screen.getByRole("complementary", { name: "census exceptions" });
    expect(disclosure.textContent).toContain("broken-receipt");
    expect(disclosure.textContent).toContain("C:\\registry\\broken.json");
    expect(disclosure.textContent).toContain("receipt JSON could not be decoded");
    expect(disclosure.textContent).toContain("404");
    expect(disclosure.textContent).toContain("process start time was unavailable");
    expect(disclosure.textContent).toContain("C:\\registry");
  });

  it("prints the leaf world and gates its pane while unbound", () => {
    const stage = { key: "declare", label: "declare", verbs: [] };
    const product = defineProduct("instances", "instances", { world: worldTrunk.link })({
      feeds: { world: { options: [], state: "ready", lane: "live", stale: false } },
      stages: [stage],
      panes: [{ key: "fleet", label: "fleet", draws: ["world"] }],
    });

    expect(
      paneState(product, product.panes[0]!, {
        isBound: () => false,
        demanded: new Set(),
        stage,
      }),
    ).toEqual({ ok: false, reason: "fleet draws from world — unbound" });
  });

  it("records a failed envelope only after it answers", async () => {
    let answer!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => (answer = resolve)),
    );
    const record = vi.fn();
    const world: WorldFacts = {
      id: "pe.app-25",
      custody: "controlled",
      phase: "ready",
      detail: "ready detail",
      row: {
        case: "controlled-active",
        bridge: { bridge: "ready", sessionDescriptor: "C:\\session.json" },
        detail: "ready detail",
        id: "pe.app-25",
        observedAtUtc: "2026-08-30T12:00:00.000Z",
        origin: "test",
        process: {
          executable: "C:\\Revit.exe",
          pid: 25,
          processStartUtc: "2026-08-30T11:59:00.000Z",
        },
        project: null,
        receipt: {
          payload: "checkout",
          buildStamp: "build",
          generationId: "generation",
          generationRoot: "C:\\generation",
          overridePath: null,
          receiptPath: "C:\\session.json",
        },
        worktree: "consumer",
        year: 2025,
      },
    };
    const verbs = worldTrunk.verbs<"world">({
      start: () => ({ lane: "dev", year: "25" }),
      started: () => {},
      settled: record,
      failed: () => {},
      finished: () => {},
    });
    const feed = worldTrunk.feed({
      worlds: [world],
      sessions: [],
      isLoading: false,
      stale: false,
      error: null,
      basis: [],
    });
    const pending = verbs.restart.run({ world: "session:pe.app-25" }, { world: feed });

    expect(record).not.toHaveBeenCalled();
    answer(
      new Response(
        JSON.stringify({
          result: { state: "refused" },
          diagnostics: [{ code: "session.failed", detail: "restart was refused" }],
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );
    await pending;

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "restart",
        ok: false,
        state: "refused",
        diagnostics: ["restart was refused"],
      }),
    );
    expect(worldTrunk.describe(record.mock.calls[0]![0])).toContain("restart was refused");
  });
});
