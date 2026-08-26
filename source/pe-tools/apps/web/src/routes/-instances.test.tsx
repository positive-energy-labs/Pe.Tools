// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const fleet = vi.hoisted(() => ({
  useFleet: vi.fn(() => ({
    worlds: [],
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
  };
});

vi.mock("#/host/fleet", () => fleet);

vi.mock("#/host/use-target", () => ({ useWorldLog: () => [] }));
vi.mock("#/host/queries", () => ({ HOST_QUERY_KEY: ["host"] }));

import { InstancesPage, recordSettledLifecycle } from "#/routes/instances";
import { worldTrunk } from "#/targeting/trunks";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("instances route", () => {
  it("mounts as an iframed workspace surface", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InstancesPage />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("instances-workspace")).toBeTruthy();
    expect(screen.getByText("no worlds known")).toBeTruthy();
    expect(fleet.useFleet).toHaveBeenCalledWith(true);
  });

  it("records a failed envelope only after it answers", async () => {
    let answer!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => (answer = resolve)),
    );
    const record = vi.fn();
    const pending = recordSettledLifecycle(
      worldTrunk.verbs.converge,
      {
        id: "pe.app-25",
        custody: "controlled",
        phase: "ready",
        openDocumentCount: 0,
      },
      undefined,
      record,
    );

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
    expect(worldTrunk.describe(record.mock.calls[0]![0])).not.toContain("started");
  });
});
