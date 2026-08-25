import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { createWorkbenchState } from "@pe/agent-contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { VerbRefused } from "#/state/route-store";
import { createChatStore, type ChatApi, type ChatSearch } from "./store";
import type { WireEvent } from "./wire";

function harness() {
  let onEvent: (event: WireEvent) => void = () => undefined;
  const sent: string[] = [];
  const patches: Array<Partial<Omit<ChatSearch, "patch">>> = [];
  const api: ChatApi = {
    session: {
      listThreads: async () => [{ id: "thread-1", updatedAt: "2026-01-01" }],
      createThread: async () => ({ id: "thread-2" }),
    },
    hydrate: async () => ({
      ...createWorkbenchState(),
      threads: {
        ...createWorkbenchState().threads,
        items: [{ threadId: "thread-1", title: "one" }],
        activeThreadId: "thread-1",
        selectedThreadId: "thread-1",
      },
    }),
    subscribe: async (next) => { onEvent = next; return () => undefined; },
    deleteThread: async () => undefined,
    cloneThread: async () => ({ id: "thread-copy" }),
    sendPrompt: async (text) => { sent.push(text); },
    abort: async () => undefined,
    rejectApproval: async () => undefined,
    resolveApproval: async () => undefined,
    setModel: async () => undefined,
    setAccessLevel: async () => undefined,
  };
  const registry = AtomRegistry.make();
  const store = createChatStore({
    registry,
    api,
    land: async () => "thread-2",
    search: {
      thread: "thread-1",
      mode: "threads",
      patch: (patch) => { patches.push(patch); },
    },
  });
  return { api, registry, store, sent, patches, event: (event: WireEvent) => onEvent(event) };
}

describe("chat store", () => {
  it("does not notify Lens for unchanged controller values across one event", async () => {
    const h = harness();
    await vi.waitFor(() => expect(h.registry.get(h.store.atoms.state).threads.items).toHaveLength(1));
    let notifications = 0;
    const unsubscribeInspect = h.registry.subscribe(h.store.atoms.lensInspectKey, () => { notifications += 1; });
    const unsubscribeFollowing = h.registry.subscribe(h.store.atoms.lensFollowing, () => { notifications += 1; });
    const renderController = () => {
      h.store.actions.setLensInspectKey(h.registry.get(h.store.atoms.lensInspectKey));
      h.store.actions.setLensFollowing(h.registry.get(h.store.atoms.lensFollowing));
    };

    renderController();
    h.event({ type: "agent_start" });
    await vi.waitFor(() => expect(h.registry.get(h.store.atoms.state).uiStatus.overall.status).toBe("running"));
    renderController();

    expect(notifications).toBe(0);
    unsubscribeInspect();
    unsubscribeFollowing();
    h.store.dispose();
  });

  it("reduces SSE in arrival order and refuses send while a run is active", async () => {
    const h = harness();
    await vi.waitFor(() => expect(h.registry.get(h.store.atoms.state).threads.items).toHaveLength(1));
    h.event({ type: "message_start", message: { id: "a", role: "assistant", content: [{ type: "text", text: "first" }] } });
    h.event({ type: "message_start", message: { id: "b", role: "assistant", content: [{ type: "text", text: "second" }] } });
    h.event({ type: "agent_start" });

    await expect(h.store.actions.send("blocked")).rejects.toBeInstanceOf(VerbRefused);
    await vi.waitFor(() => expect(h.registry.get(h.store.atoms.state).transcript.messages.map((message) => message.id)).toEqual(["a", "b"]));
    expect(h.sent).toEqual([]);
    h.store.dispose();
  });

  it("debounces search mirrors and patches a new thread", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.store.actions.setDraft({ text: "short", attachments: [] });
    await vi.advanceTimersByTimeAsync(300);
    expect(h.patches.at(-1)).toEqual({ prompt: "short" });

    h.store.actions.setDraft({ text: "short", attachments: [{ name: "plan.md", text: "x" }] });
    expect(h.patches.at(-1)).toEqual({ prompt: undefined });
    h.store.actions.setTurn(4);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.patches).not.toContainEqual({ turn: 4 });
    await vi.advanceTimersByTimeAsync(1);
    expect(h.patches.at(-1)).toEqual({ turn: 4 });
    await h.store.actions.newThread();
    expect(h.patches.at(-1)).toEqual({ thread: "thread-2" });
    h.store.dispose();
    vi.useRealTimers();
  });
});
