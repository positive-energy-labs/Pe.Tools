// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  };
});

vi.mock("#/host/fleet", () => fleet);

vi.mock("#/host/use-target", () => ({ useWorldLog: () => [] }));
vi.mock("#/host/queries", () => ({ HOST_QUERY_KEY: ["host"] }));

import { InstancesPage, recordSettledLifecycle } from "#/routes/instances";
import { paneState } from "#/targeting/kit";
import type { Product } from "#/targeting/model";
import { worldTrunk } from "#/targeting/trunks";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("instances route", () => {
  it("mounts the route with graveyard rows outside the live-world picker", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InstancesPage />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("instances-workspace")).toBeTruthy();
    expect(screen.getAllByText("pe.app-25").length).toBeGreaterThan(0);
    expect(screen.getByText("installed-25")).toBeTruthy();
    expect(fleet.useFleet).toHaveBeenCalledWith(true);

    const picker = screen.getByRole("button", { name: "pick a world" });
    expect((picker.closest("span.inline-flex.flex-col") as HTMLElement).style.opacity).toBe("1");
    fireEvent.click(picker);
    const popover = picker.closest("span.relative") as HTMLElement;
    expect(within(popover).getByText("pe.app-25")).toBeTruthy();
    expect(within(popover).queryByText("installed-25")).toBeNull();
  });

  it("keeps a managed-trunk pane ready while the trunk is unbound", () => {
    const stage = { key: "declare", label: "declare", verbs: [] };
    const product: Product = {
      key: "instances",
      name: "instances",
      links: [worldTrunk.link],
      manages: ["world"],
      stages: [stage],
      panes: [{ key: "fleet", label: "fleet", draws: ["world"] }],
    };

    expect(
      paneState(product, product.panes[0]!, {
        isBound: () => false,
        demanded: new Set(),
        stage,
      }),
    ).toEqual({ ok: true, reason: "fleet draws from world" });
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
