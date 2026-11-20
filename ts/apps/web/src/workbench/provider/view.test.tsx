import * as Atom from "effect/reactivity/Atom";
// @vitest-environment jsdom
/** First Send from a standalone tool: one chat, seeded only by the composer, the tool kept. */
import { useContext, useMemo } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { seedPlaces } from "../places.test-support";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { RegistryContext } from "@effect/atom-react";
import { appAtomRegistry } from "#/shell/owner";
import { emptyChatState, type ChatState } from "@pe/agent-contracts/chat-state";
import { harnessEventSchema } from "@pe/agent-contracts";
import { useTranscript } from "./use-workbench";
import { WorkbenchContext } from "./thread-summary";
import { WorkbenchProvider } from "./view";
import { machineFixture } from "../../../../../packages/agent-contracts/tests/machine-fixture.ts";
import { useThreadHead } from "#/chat/composer-head";
import { Ladder } from "#/route/ladder";
import { useRouteTabs } from "../tabs";

const client = vi.hoisted(() => ({
  create: vi.fn(async (_provider: string) => ({ id: "NEW", head: { revision: 0 }, modelId: "m" })),
  target: vi.fn(async () => ({ ok: true })),
  prompt: vi.fn(async () => ({})),
  threads: vi.fn(async () => [] as unknown[]),
  summaries: () => () => {},
  model: vi.fn(),
  trait: vi.fn(),
}));
const call = vi.hoisted(() => vi.fn(async (..._: unknown[]) => ({})));
vi.mock("./harness-client", () => ({ harnessClient: () => client, notFound: () => false }));
let publishChat: (chat: ChatState) => void;
vi.mock("./thread-stream", () => ({
  useThreadStream: () => {
    const chatAtom = useMemo(() => Atom.make(emptyChatState()), []);
    publishChat = (chat) => appAtomRegistry.set(chatAtom, chat);
    return { chatAtom, bodyAtom: null, pending: false, error: undefined };
  },
  chatLoading: () => false,
}));
vi.mock("@pe/agent-contracts/chat-state", async (actual) => ({
  ...(await actual<object>()),
  selectRunStatus: () => "idle",
  selectTurnFailure: () => undefined,
}));
vi.mock("./providers", () => {
  const providers = { list: [{ id: "p", name: "P", readiness: { state: "ready" } }] };
  return {
    EMPTY_HEAD: { traits: {} },
    isReady: () => true,
    useProviders: () => providers,
  };
});
// No composer document unless a test sets a machine reading: the machine has none to offer.
const machine = vi.hoisted(() => ({ reading: null as unknown }));
vi.mock("#/machine/use-machine", () => ({
  useMachineSlice: (select: (reading: unknown) => unknown) =>
    machine.reading ? select(machine.reading) : null,
}));
vi.mock("#/host/resource-stream", async (actual) => ({
  ...(await actual<typeof import("#/host/resource-stream")>()),
  useHostEvents: () => {},
}));
vi.mock("#/host/resource-state", () => {
  const host = { known: true };
  return {
    previousOf: () => undefined,
    useReading: () => ({ state: "absent" }),
    useReadingSlice: (_request: unknown, select: (reading: unknown) => unknown) =>
      select({ state: "absent" }),
    useHostStatusSlice: () => host,
  };
});
vi.mock("#/navigation/surface-host", () => ({ useSurfaceHost: () => ({ surface: "web" }) }));
vi.mock("#/host/pe-client", () => ({ peClient: { call } }));

afterEach(() => {
  cleanup();
  machine.reading = null;
  vi.clearAllMocks();
});
beforeEach(() => seedPlaces([]));

let send: ((text: string) => Promise<void>) | null = null;
let openThread: ((id: string) => void) | null = null;
let draftTarget: unknown;
function Probe() {
  useRouteTabs();
  const context = useContext(WorkbenchContext)!;
  draftTarget = context.draftTarget;
  send = (text) => context.sendPrompt({ text } as never);
  openThread = context.openThread;
  return null;
}

test("first Send from /duct-systems?target=… creates one chat with no targets and keeps the tool", async () => {
  sessionStorage.clear();
  const root = createRootRoute({
    component: () => (
      <WorkbenchProvider>
        <Probe />
        {/* Stands in for the composer: it lives outside the routed body. */}
        <input aria-label="draft" />
        <Outlet />
      </WorkbenchProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/" }),
      createRoute({
        getParentRoute: () => root,
        path: "/duct-systems",
        component: () => <p>duct-systems</p>,
      }),
    ]),
    history: createMemoryHistory({
      initialEntries: ["/", "/duct-systems?target=C%3A%2FModels%2FOffice.rvt"],
    }),
  });
  await router.load();
  // The roster lists the new chat once the host made it.
  client.threads.mockImplementation(async () => [
    {
      id: "NEW",
      head: { revision: 0, targets: [] },
      lifecycle: { revision: 0, readSeq: 0 },
      activity: { lastSeq: 0 },
      lastSeq: 0,
      updatedAt: "2026-10-25T00:00:00.000Z",
    },
  ]);
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <RouterProvider router={router} />
    </RegistryContext.Provider>,
  );
  await screen.findByText("duct-systems");
  fireEvent.change(screen.getByLabelText("draft"), { target: { value: "unsent words" } });
  await act(() => send!("size it"));

  expect(client.create).toHaveBeenCalledTimes(1);
  // initialTargets = []: the tool's pin never seeds the chat's targets.
  expect(client.target).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe("/duct-systems");
  expect(router.state.location.search).toMatchObject({
    target: "C:/Models/Office.rvt",
    thread: "NEW",
  });
  expect(client.prompt).toHaveBeenCalledWith("NEW", expect.objectContaining({ text: "size it" }));
  expect(call.mock.calls.filter(([door]) => door === "thread.place")).toEqual([
    [
      "thread.place",
      {
        params: { id: "NEW" },
        body: { route: "duct-systems", link: expect.stringContaining("/duct-systems") },
      },
    ],
  ]);

  // Promotion replaced the tool entry: Back is Home, Forward is the promoted tool; the draft stays.
  await act(async () => router.history.back());
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  await act(async () => router.history.forward());
  await waitFor(() => expect(router.state.location.pathname).toBe("/duct-systems"));
  expect(router.state.location.search).toMatchObject({ thread: "NEW" });
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("unsent words");
  expect(client.create).toHaveBeenCalledTimes(1);
  await act(async () => {
    openThread!("OTHER");
  });
  await waitFor(() => expect(router.state.location.search.thread).toBe("OTHER"));
  expect(router.state.location.pathname).toBe("/duct-systems");
  expect(router.state.location.search.target).toBe("C:/Models/Office.rvt");
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("unsent words");
});

test("a streamed chat chunk updates the transcript without rendering a route pane", async () => {
  let paneRenders = 0;
  let transcriptRenders = 0;
  let composerRenders = 0;
  function ComposerConsumer() {
    const head = useTranscript(({ providerId, promptCapabilities }) => ({
      providerId,
      promptCapabilities,
    }));
    composerRenders++;
    return <span>{head.providerId}</span>;
  }
  function PaneConsumer() {
    const context = useContext(WorkbenchContext)!;
    paneRenders++;
    return <p>pane {context.currentThreadId}</p>;
  }
  function TranscriptConsumer() {
    const chat = useTranscript((state) => state);
    transcriptRenders++;
    return <output>events {chat.events.length}</output>;
  }
  const root = createRootRoute({
    component: () => (
      <WorkbenchProvider>
        <PaneConsumer />
        <TranscriptConsumer />
        <ComposerConsumer />
        <Outlet />
      </WorkbenchProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: "/" })]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <RouterProvider router={router} />
    </RegistryContext.Provider>,
  );
  await screen.findByText("events 0");
  await act(async () => {});
  const paneBefore = paneRenders;
  const transcriptBefore = transcriptRenders;
  const composerBefore = composerRenders;
  const chunk = harnessEventSchema.parse({
    kind: "update",
    turnId: "turn-1",
    seq: 1,
    at: "2026-11-03T00:00:00Z",
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
  });
  await act(async () => publishChat({ ...emptyChatState(), events: [chunk] }));
  expect(screen.getByText("events 1")).toBeTruthy();
  expect(transcriptRenders).toBeGreaterThan(transcriptBefore);
  expect(paneRenders).toBe(paneBefore);
  expect(composerRenders).toBe(composerBefore);
});

// Row 12 (owner ruling 2026-11-13): a docked thread binds to the document the URL's `?target` names,
// including a draft with no id yet. The draft's document is the workbench's `draftTarget`, which
// the composer's picker draws (chat/composer-head.tsx `useThreadHead`).
test.each([false, true])(
  "review probe: a ?target naming a document that is not open leaves the sole other document unbound: %s",
  async (missing) => {
    sessionStorage.clear();
    const doc = (openId: string) => ({
      openId,
      title: `${openId}.rvt`,
      address: `C:/Jobs/${openId}.rvt`,
      isFamilyDocument: false,
      isActive: true,
    });
    machine.reading = {
      state: "ready",
      observation: machineFixture([{ session: "s1", documents: [doc("B")] }]),
    };
    const root = createRootRoute({
      component: () => (
        <WorkbenchProvider>
          <Probe />
          <Outlet />
        </WorkbenchProvider>
      ),
    });
    const router = createRouter({
      routeTree: root.addChildren([
        createRoute({ getParentRoute: () => root, path: "/fans", component: () => <p>fans</p> }),
      ]),
      history: createMemoryHistory({
        initialEntries: [missing ? "/fans?target=C%3A%2FJobs%2FA.rvt" : "/fans"],
      }),
    });
    await router.load();
    client.threads.mockImplementation(async () => []);
    render(
      <RegistryContext.Provider value={appAtomRegistry}>
        <RouterProvider router={router} />
      </RegistryContext.Provider>,
    );
    await screen.findByText("fans");
    expect(draftTarget).toEqual(
      missing ? null : { kind: "open", ref: { session: "s1", openId: "B" } },
    );
  },
);

function DraftDocumentControl() {
  const head = useThreadHead();
  return (
    <Ladder
      disabled={head.stale}
      title="Draft document"
      face="control"
      levels={[
        {
          key: "document",
          label: "A.rvt",
          placeholder: "choose document",
          multi: true,
          options: [{ id: "A", label: "A.rvt" }],
          checked: () => head.targets.length > 0,
          pick: () => {
            void head.toggle({ kind: "open", ref: { session: "s1", openId: "A" } });
          },
        },
      ]}
    />
  );
}

test("on /fans?target=A a new thread's draft binds to A among two open documents, and its first Send seeds A", async () => {
  sessionStorage.clear();
  const doc = (openId: string) => ({
    openId,
    title: `${openId}.rvt`,
    address: `C:/Jobs/${openId}.rvt`,
    isFamilyDocument: false,
    isActive: true,
  });
  machine.reading = {
    state: "ready",
    observation: machineFixture([{ session: "s1", documents: [doc("A"), doc("B")] }]),
  };
  const root = createRootRoute({
    component: () => (
      <WorkbenchProvider>
        <Probe />
        <DraftDocumentControl />
        <Outlet />
      </WorkbenchProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/fans", component: () => <p>fans</p> }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/fans?target=C%3A%2FJobs%2FA.rvt"] }),
  });
  await router.load();
  client.threads.mockImplementation(async () => []);
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <RouterProvider router={router} />
    </RegistryContext.Provider>,
  );
  await screen.findByText("fans");
  expect(router.state.location.search).not.toHaveProperty("thread");
  expect(draftTarget).toEqual({ kind: "open", ref: { session: "s1", openId: "A" } });
  const control = screen.getByRole("button", { name: "Choose document" });
  expect(control.hasAttribute("disabled")).toBe(false);
  fireEvent.click(control);
  fireEvent.click(await screen.findByRole("option", { name: "A.rvt" }));
  await waitFor(() => expect(draftTarget).toBeNull());
  // Toggling the same document back on restores the first-Send seed.
  fireEvent.click(screen.getByRole("option", { name: "A.rvt" }));
  await waitFor(() =>
    expect(draftTarget).toEqual({ kind: "open", ref: { session: "s1", openId: "A" } }),
  );
  await act(() => send!("size it"));
  expect(client.create).toHaveBeenCalledTimes(1);
  expect(client.target).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(client.target.mock.calls[0])).toContain('"openId":"A"');
});

// Review of c6bd362b, probe 2: a `?target` that names a document which is not open binds nothing.
// The sole open document is the default only when the URL names no document.
test("a ?target naming a document that is not open leaves the draft unbound, never the sole open document", async () => {
  sessionStorage.clear();
  const doc = (openId: string) => ({
    openId,
    title: `${openId}.rvt`,
    address: `C:/Jobs/${openId}.rvt`,
    isFamilyDocument: false,
    isActive: true,
  });
  machine.reading = {
    state: "ready",
    observation: machineFixture([{ session: "s1", documents: [doc("B")] }]),
  };
  const root = createRootRoute({
    component: () => (
      <WorkbenchProvider>
        <Probe />
        <Outlet />
      </WorkbenchProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/fans", component: () => <p>fans</p> }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/fans?target=C%3A%2FJobs%2FA.rvt"] }),
  });
  await router.load();
  client.threads.mockImplementation(async () => []);
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <RouterProvider router={router} />
    </RegistryContext.Provider>,
  );
  await screen.findByText("fans");
  expect(draftTarget).toBeNull();
  await act(() => send!("size it"));
  expect(client.create).toHaveBeenCalledTimes(1);
  expect(client.target, "nothing seeds the chat with B").not.toHaveBeenCalled();
  // With no pin, the same machine's sole document is the default, as before.
  act(() => router.history.push("/fans"));
  await waitFor(() =>
    expect(draftTarget).toEqual({ kind: "open", ref: { session: "s1", openId: "B" } }),
  );
});
