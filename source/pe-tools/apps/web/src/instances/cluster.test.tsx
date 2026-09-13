// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import type { SessionInventory } from "#/readings";
import { InstancesCluster } from "#/instances/cluster";
import type { InstancesFleet } from "#/instances/workspace";

const { admission, written } = vi.hoisted(() => ({
  admission: vi.fn(async (..._args: unknown[]) => ({ id: "test", state: "succeeded" })),
  written: vi.fn(),
}));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  runSemanticAction: admission,
}));
vi.mock("#/actions/receipt", () => ({ ActionReceipts: () => null }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useSearch: () => ({}),
}));

/** The SDK reads answer empty: this test drives staging, not the census. */
vi.mock("#/readings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/readings")>()),
  readReading: vi.fn(async () => ({ result: {} })),
}));

/**
 * Work, held in the component tree instead of the host. The deleted `source="fixture"` lane made
 * the cluster keep staging in local state; the route primitive has ONE staging model, so the test
 * seeds the same Work the host would hold and lets `apply` advance it.
 */
vi.mock("#/workbench/route-state", () => ({
  useRouteState: () => {
    const [slice, setSlice] = useState<{ staged: unknown }>({ staged: null });
    return {
      slice,
      revision: 0,
      hydrated: true,
      refreshing: false,
      outcomeUnknown: false,
      apply: async (patches: { path: string[]; value: unknown }[]) => {
        written(patches);
        setSlice((current) => {
          const next = { ...current } as Record<string, unknown>;
          for (const patch of patches) next[patch.path[0]!] = patch.value;
          return next as { staged: unknown };
        });
        return { ok: true, revision: 7 };
      },
      command: async () => ({ ok: true }),
      peaActive: false,
      connected: true,
      failure: null,
      busy: null,
      atoms: {},
      lastCommand: null,
    };
  },
}));

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

test("uses the staged document and admits the displayed session name at its written revision", async () => {
  const activeDocumentId = "C:\\Models\\projectA.rvt";
  const session: SessionInventory = {
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
    basis: ["test"],
  };
  const onDocument = vi.fn();

  const mounted = render(
    <InstancesCluster
      fleet={fleet}
      target="pe.app-25"
      setTarget={() => {}}
      onDocument={onDocument}
    />,
  );

  fireEvent.click(within(screen.getAllByRole("grid")[1]!).getByText("projectA.rvt").closest("tr")!);
  fireEvent.click(screen.getByRole("button", { name: "use" }));

  expect(onDocument).toHaveBeenCalledWith({
    kind: "document",
    document: activeDocumentId,
    pin: "pe.app-25",
  });

  mounted.rerender(
    <InstancesCluster
      fleet={{ ...fleet, worlds: [], sessions: [] }}
      target="pe.app-25"
      setTarget={() => {}}
      requestedDocument={"C:\\Models\\Unlisted.rvt"}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /recover Unlisted.rvt/i }));
  expect(
    screen.getByText("Pick a session or Revit year before opening this document."),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "2025" }));
  fireEvent.click(screen.getByRole("button", { name: /recover Unlisted.rvt/i }));
  fireEvent.change(screen.getByRole("textbox", { name: "session name" }), {
    target: { value: "ux-revival" },
  });
  fireEvent.click(screen.getByRole("button", { name: "start ux-revival" }));
  await waitFor(() => expect(admission).toHaveBeenCalled());
  expect(written).toHaveBeenLastCalledWith([
    {
      path: ["staged"],
      value: {
        kind: "start",
        year: "2025",
        name: "ux-revival",
        document: "C:\\Models\\Unlisted.rvt",
      },
    },
  ]);
  expect(admission.mock.calls[0]?.[3]).toMatchObject({ work: { revision: 7 } });
});
