// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import type { SessionFacts } from "#/host/target";
import { InstancesCluster } from "#/instances/cluster";
import type { InstancesFleet } from "#/instances/workspace";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useSearch: () => ({}),
}));

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

test("hands an explicitly staged open document to an embedding route without reopening it", () => {
  const activeDocumentId = "C:\\Models\\projectA.rvt";
  const session: SessionFacts = {
    sessionId: "bridge-pe.app-25",
    sdkSessionId: "pe.app-25",
    processId: 25,
    year: "2025",
    lane: "dev",
    custody: "controlled",
    activeDocumentId,
    activeDocumentTitle: "projectA.rvt",
    openDocumentCount: 1,
  };
  const fleet: InstancesFleet = {
    sessions: [session],
    worlds: [
      {
        id: "pe.app-25",
        custody: "controlled",
        phase: "ready",
        detail: "ready",
        lane: "dev",
        pid: 25,
        session,
      },
    ],
    unreadableReceipts: [],
    processReadErrors: [],
    registryRoot: "C:\\registry",
    isLoading: false,
    stale: false,
    error: null,
    at: 1,
    basis: ["test"],
  };
  const onDocument = vi.fn();

  render(
    <QueryClientProvider client={new QueryClient()}>
      <InstancesCluster
        fleet={fleet}
        target=""
        setTarget={() => {}}
        source="fixture"
        onDocument={onDocument}
      />
    </QueryClientProvider>,
  );

  fireEvent.click(within(screen.getAllByRole("grid")[1]!).getByText("projectA.rvt").closest("tr")!);
  fireEvent.click(screen.getByRole("button", { name: "use" }));

  expect(onDocument).toHaveBeenCalledWith({
    kind: "document",
    document: activeDocumentId,
    pin: "pe.app-25",
  });
});
