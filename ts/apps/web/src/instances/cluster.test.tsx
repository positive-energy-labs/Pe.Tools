// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { instancesRouteState } from "@pe/agent-contracts";
import type { Inventory } from "#/readings";
import type { InstancesHandle } from "./manifest";
import type { InstancesFleet } from "./route";
import { InstancesCluster } from "./cluster";
import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";

vi.mock("#/readings", async (original) => ({
  ...(await original<typeof import("#/readings")>()),
  useHostCall: (_read: unknown, key: string[]) => ({
    data: key[0] === "actions" || key[1] === "recents" ? [] : { result: { revitYears: ["2025"] } },
    isPending: false,
  }),
}));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  readScopedActionStatuses: vi.fn(),
  runSemanticAction: vi.fn(async () => ({ id: "open-action", state: "succeeded" })),
}));
// jsdom has no scrolling implementation.
HTMLElement.prototype.scrollIntoView = vi.fn();
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const process = {
  pid: 4242,
  processStartUtc: "2026-10-09T12:00:00.0000000Z",
  executable: "C:/Revit.exe",
};
const world: Inventory = {
  id: "4242",
  pid: 4242,
  custody: "observed",
  phase: "ready",
  detail: "observed",
  lane: "installed",
  row: {
    case: "observed-active",
    process,
    observedAtUtc: process.processStartUtc,
    year: 2025,
    bridge: { bridge: "answering", sessionDescriptor: null },
    shape: {
      payload: "installed",
      posture: "foreground",
      purpose: "interactive",
      quarantine: false,
      reload: "none",
    },
  },
  session: {
    sessionId: "4242",
    processId: 4242,
    custody: "observed",
    lane: "installed",
    year: "2025",
    openDocuments: [],
    openDocumentCount: 0,
  },
};
const key = { binding: "workspace" as const, route: "instances", target: null, work: "instances" };
function draw(staged = true, connected = true) {
  const handle = {
    work: {
      key,
      revision: 7,
      current: true,
      write: vi.fn(async () => null),
      doc: instancesRouteState.schema.parse(
        staged
          ? {
              launch: {
                staged: {
                  value: {
                    kind: "open",
                    session: { pid: 4242 },
                    document: "C:/Tower.rvt",
                  },
                },
              },
            }
          : {},
      ),
    },
    note: vi.fn(),
  } as unknown as InstancesHandle;
  const picked = connected ? world : { ...world, session: undefined };
  const fleet = {
    worlds: [picked],
    isLoading: false,
    unreadableReceipts: [],
    processReadErrors: [],
  } as unknown as InstancesFleet;
  render(
    <InstancesCluster
      handle={handle}
      fleet={fleet}
      target={connected ? "4242" : "Revit 4242"}
      setTarget={() => {}}
    />,
  );
}

test("a staged open in an observed process reaches the semantic action with the original incarnation", async () => {
  draw();
  const open = screen.getByRole("button", { name: "open" });
  expect(open.getAttribute("aria-disabled")).not.toBe("true");
  fireEvent.click(open);
  await waitFor(() => expect(runSemanticAction).toHaveBeenCalled());
  expect(vi.mocked(runSemanticAction).mock.calls[0]!.slice(0, 4)).toEqual([
    "instances.open",
    { workspaceId: "instances", session: { selection: { pid: 4242 }, process } },
    undefined,
    { work: { key, revision: 7 } },
  ]);
});

test("an installed observed process keeps HR gated and stop requires an unsaved choice", () => {
  draw(false);
  for (const name of ["restart · discard edits", "stop"]) {
    const button = screen.getByRole("button", { name });
    expect(button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true").toBe(
      true,
    );
    fireEvent.click(button);
  }
  expect(runSemanticAction).not.toHaveBeenCalled();
});
