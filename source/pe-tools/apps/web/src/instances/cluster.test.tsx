// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import type { InstancesDocument } from "@pe/agent-contracts";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

import type { SessionInventory } from "#/readings";
import { InstancesCluster } from "#/instances/cluster";
import type { InstancesFleet } from "#/instances/workspace";
import { INSTANCES_WORK, instancesManifest, type InstancesHandle } from "#/instances/manifest";

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

function ClusterHarness({ ...props }: Omit<ComponentProps<typeof InstancesCluster>, "handle">) {
  const [work, setWork] = useState({ doc: { launch: {} } as InstancesDocument, revision: 0 });
  const handle = {
    manifest: instancesManifest,
    work: {
      key: INSTANCES_WORK,
      doc: work.doc,
      revision: work.revision,
      current: true,
      write: async (patches: { path: (string | number)[]; value?: unknown }[]) => {
        written(patches);
        setWork((current) => {
          // Every Instances write is one rung on the launch cell: ["launch", "proposal" | "staged"].
          const doc = structuredClone(current.doc) as InstancesDocument;
          for (const { path, value } of patches)
            (doc.launch as Record<string, unknown>)[String(path[1])] = value;
          return { doc, revision: current.revision + 1 };
        });
        return null;
      },
    },
    failure: null,
  } as InstancesHandle;
  return <InstancesCluster {...props} handle={handle} />;
}

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
    <ClusterHarness
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
    <ClusterHarness
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
      path: ["launch", "staged"],
      value: {
        value: {
          kind: "start",
          year: "2025",
          name: "ux-revival",
          document: "C:\\Models\\Unlisted.rvt",
        },
      },
    },
  ]);
  expect(admission.mock.calls[0]?.[3]).toMatchObject({ work: { revision: 3 } });
  const firstId = admission.mock.calls[0]?.[6];
  expect(firstId).toEqual(expect.any(String));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "start ux-revival" }).hasAttribute("disabled")).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "start ux-revival" }));
  await waitFor(() => expect(admission).toHaveBeenCalledTimes(2));
  expect(admission.mock.calls[1]?.[6]).not.toBe(firstId);
});
