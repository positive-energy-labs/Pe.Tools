// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MastraClient } from "@mastra/client-js";
import { afterEach, expect, it, vi } from "vite-plus/test";

const route = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: { mode: "threads", thread: "draft-thread" },
}));
const infoQuery = vi.hoisted(() => ({
  data: {
    controllerId: "pea",
    resourceId: "resource",
    capabilities: { revit: false },
  },
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => route.navigate,
  useSearch: () => route.search,
}));

vi.mock("#/host/info", () => ({
  usePeInfo: () => infoQuery,
}));

import { WorkbenchProvider } from "./view";
import { useWorkbench } from "./use-workbench";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("does not persist a new thread until its first send", async () => {
  const session = {
    create: vi.fn(),
    listThreads: vi.fn().mockResolvedValue([]),
  };
  vi.spyOn(MastraClient.prototype, "getAgentController").mockReturnValue({
    session: () => session,
  } as never);

  render(
    <WorkbenchProvider>
      <span>draft</span>
    </WorkbenchProvider>,
  );

  await waitFor(() => expect(session.listThreads).toHaveBeenCalledOnce());
  expect(session.create).not.toHaveBeenCalled();
});

it("removes a thread from the rendered list after deletion succeeds", async () => {
  const session = {
    deleteThread: vi.fn().mockResolvedValue(undefined),
    listThreads: vi
      .fn()
      .mockResolvedValueOnce([
        { id: "thread-other", title: "Other thread", updatedAt: "2026-09-01T00:00:00Z" },
      ])
      .mockResolvedValue([]),
  };
  vi.spyOn(MastraClient.prototype, "getAgentController").mockReturnValue({
    session: () => session,
  } as never);

  function ThreadRows() {
    const workbench = useWorkbench();
    return workbench.threads.map((thread) => (
      <button key={thread.id} onClick={() => void workbench.deleteThread(thread.id)}>
        {thread.title}
      </button>
    ));
  }

  render(
    <WorkbenchProvider>
      <ThreadRows />
    </WorkbenchProvider>,
  );

  fireEvent.click(await screen.findByRole("button", { name: "Other thread" }));
  await waitFor(() => expect(session.deleteThread).toHaveBeenCalledWith("thread-other"));
  await waitFor(() => expect(screen.queryByText("Other thread")).toBeNull());
});
