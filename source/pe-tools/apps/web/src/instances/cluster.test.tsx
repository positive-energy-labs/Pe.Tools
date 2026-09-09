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

test("hands an explicitly staged inactive document to an embedding route without reopening it", () => {
  const activeDocumentId = "C:\\Models\\projectA.rvt";
  const session: SessionFacts = {
    sessionId: "bridge-pe.app-25",
    sdkSessionId: "pe.app-25",
    processId: 25,
    year: "2025",
    lane: "dev",
    custody: "controlled",
    activeDocumentId: "C:\\Models\\Other.rvt",
    activeDocumentTitle: "Other.rvt",
    openDocumentCount: 2,
    openDocuments: [
      {
        openId: "project-a-open",
        address: activeDocumentId,
        title: "projectA.rvt",
        isActive: false,
        isFamilyDocument: false,
      },
      {
        openId: "other-open",
        address: "C:\\Models\\Other.rvt",
        title: "Other.rvt",
        isActive: true,
        isFamilyDocument: false,
      },
    ],
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

  const mounted = render(
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

  mounted.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <InstancesCluster
        fleet={{ ...fleet, worlds: [], sessions: [] }}
        target=""
        setTarget={() => {}}
        source="fixture"
        requestedDocument="C:\\Models\\Unlisted.rvt"
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /recover Unlisted.rvt/i }));
  expect(
    screen.getByText("Pick a session or Revit year before opening this document."),
  ).toBeTruthy();
});
