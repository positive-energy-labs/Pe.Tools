// @vitest-environment jsdom
/**
 * Under Pea's floor the threads and chat panes trade one rail. Picking a thread reveals the chat
 * pane, and the palette shortcut reveals the threads pane, through the layout's own fold state
 * (the kernel's `GraphLayoutState`), never a store atom.
 */
import { useState } from "react";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { GraphLayoutView } from "../../../../packages/kit/src/components/lang/graph-layout";
import type { GraphLayoutState } from "../../../../packages/kit/src/components/lang/graph-layout";
import { RouterContextProvider, createRouter, createMemoryHistory } from "@tanstack/react-router";
import { Route as rootRoute } from "../routes/__root";
import { chatLayout } from "./route";
import { ThreadsDrawing } from "./chat-drawing";
import type { ChatHandle } from "./owner-ports";

vi.mock("../routes/__root", async () => {
  const { createRootRoute } = await import("@tanstack/react-router");
  return { Route: createRootRoute() };
});
vi.mock("#/navigation/surface-host", () => ({ useSurfaceHost: () => ({ surface: "web" }) }));
const openThread = vi.fn();
vi.mock("#/workbench/provider", () => ({
  useWorkbench: () => ({
    store: { actions: { openWork: vi.fn(), forgetThread: vi.fn(), compose: vi.fn() } },
    threads: [],
    rosterRead: true,
    providers: { list: [] },
    currentThreadId: "",
    forkThread: vi.fn(),
    openThread,
    renameThread: vi.fn(),
    deleteThread: vi.fn(),
    updateThread: vi.fn(),
    newThread: vi.fn(),
  }),
  useTranscript: () => "",
  useTranscriptAtom: () => null,
}));
vi.mock("#/chat/composer-head", () => ({ useChatSituation: () => ({ inventory: [] }) }));
vi.mock("#/route/activity", () => ({
  useRouteSearchSlice: () => ({ threadSearch: undefined, threadSort: "" }),
}));
let palette: (open: boolean) => void = () => {};
vi.mock("#/navigation/route-controls", () => ({
  PrimaryRouteControls: () => null,
  usePublishPagePalette: (_route: string, _open: boolean, set: (open: boolean) => void) => {
    palette = set;
  },
}));
vi.mock("#/chat/thread-palette", () => ({
  NewThreadButton: () => null,
  ThreadsSidebar: ({ onSelect, searchSerial }: { onSelect(id: string): void; searchSerial: number }) => (
    <nav aria-label="Threads">
      <div role="option" aria-selected={false} onClick={() => onSelect("office")}>
        Office model
      </div>
      <output aria-label="search serial">{searchSerial}</output>
    </nav>
  ),
}));

const handle = { selection: { read: () => [], set: () => {} } } as unknown as ChatHandle;

beforeEach(() => {
  // Pea's surface at 1400x900 with the tools open: 683px, under threads + Pea's 643px floor.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 683, 800),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  openThread.mockReset();
});

function Pea() {
  const [panes, onChange] = useState<GraphLayoutState>({});
  return (
    <GraphLayoutView
      layout={chatLayout}
      panes={{
        threads: { label: "threads", purpose: "Choose a conversation", verbs: [], draws: [] },
        chat: { label: "chat", purpose: "Read and compose", verbs: [], draws: [] },
      }}
      active={() => true}
      state={{ panes, onChange }}
      bodies={{
        threads: (pane) => pane(<ThreadsDrawing ctx={handle} />),
        chat: (pane) => pane(<input aria-label="draft" defaultValue="kept" />),
      }}
    />
  );
}

async function mount() {
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(
    <RouterContextProvider router={router}>
      <Pea />
    </RouterContextProvider>,
  );
}

test("picking a thread while the chat pane is folded reveals the chat pane", async () => {
  await mount();
  const draft = screen.getByRole("textbox", { name: "draft" });
  fireEvent.click(screen.getByRole("button", { name: "Expand threads" }));
  expect(draft.closest(".hidden"), "chat folds under the floor when threads opens").toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: "Office model" }));
  expect(openThread).toHaveBeenCalledWith("office");
  expect(draft.closest(".hidden"), "the picked thread's chat pane is shown").toBeNull();
});

test("the palette shortcut unfolds a folded threads pane and focuses its search", async () => {
  await mount();
  const office = () => screen.getByRole("option", { name: "Office model", hidden: true });
  expect(office().closest(".hidden"), "threads start folded under the floor").toBeTruthy();
  act(() => palette(true));
  expect(office().closest(".hidden"), "the palette shows the thread list").toBeNull();
  expect(screen.getByRole("status", { name: "search serial", hidden: true }).textContent).toBe("1");
});
