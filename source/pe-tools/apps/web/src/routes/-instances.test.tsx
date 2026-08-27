// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const fleet = vi.hoisted(() => ({
  useFleet: vi.fn(() => ({
    worlds: [
      {
        id: "pe.app-25",
        custody: "controlled",
        phase: "ready",
        pid: 25,
        openDocumentCount: 0,
        row: { id: "pe.app-25" },
      },
      {
        id: "installed-25",
        custody: "controlled",
        phase: "gone",
        pid: 88,
        openDocumentCount: 0,
        row: { id: "installed-25" },
      },
    ],
    sessions: [],
    isLoading: false,
    stale: false,
    error: null,
    at: 123,
    basis: ["sessions.status", "bridge.sessions.list"],
  })),
}));

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
import type { WorldFacts } from "#/host/fleet";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("instances route", () => {
  it("asks for a document before mounting the route document", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InstancesPage />
      </QueryClientProvider>,
    );

    expect(screen.getByText("pick a document")).toBeTruthy();
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
      openDocumentCount: 0,
      row: { id: "pe.app-25" } as WorldFacts["row"],
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
    const pending = verbs.converge.run({ world: "session:pe.app-25" }, { world: feed });

    expect(record).not.toHaveBeenCalled();
    answer(
      new Response(
        JSON.stringify({
          result: { state: "refused" },
          diagnostics: [{ code: "session.failed", detail: "converge was refused" }],
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );
    await pending;

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "converge",
        ok: false,
        state: "refused",
        diagnostics: ["converge was refused"],
      }),
    );
    expect(worldTrunk.describe(record.mock.calls[0]![0])).toContain("converge was refused");
  });
});
