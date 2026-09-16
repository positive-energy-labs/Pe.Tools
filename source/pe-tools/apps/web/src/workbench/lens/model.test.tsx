// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MastraDBMessage } from "@mastra/client-js";
import { RegistryContext } from "@effect/atom-react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useCallback } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { emptyChatState, type ChatState } from "../chat-state";
import { createChatPageStore, type ChatPageStore } from "../store";

const workbench = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("../provider", () => ({ useWorkbench: () => workbench.value }));
vi.mock("../world", () => ({ useCacheView: () => ({ changed: new Set() }) }));
vi.mock("#/chat/scope", () => ({
  useThreadScope: () => ({ defaultTarget: null, revision: 0 }),
}));

import { useLensModel } from "./model";
import { FOCAL } from "./scale";

// Geometry the browser would give: every moment is `H` tall unless `heights` says otherwise,
// stacked in DOM order; the scroller is `V` tall and clamps its scrollTop.
const H = 300;
const V = 600;
const FOCAL_TOP = FOCAL * V;
const heights = new Map<string, number>();
const heightOf = (el: Element) => heights.get((el as HTMLElement).dataset.key ?? "") ?? H;

class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  targets: Element[] = [];
  constructor(private callback: () => void) {
    FakeResizeObserver.all.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  disconnect() {
    this.targets = [];
  }
  static resize(target: Element) {
    for (const observer of FakeResizeObserver.all)
      if (observer.targets.includes(target)) observer.callback();
  }
}

beforeEach(() => {
  heights.clear();
  FakeResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.dataset.moment === undefined ? 0 : heightOf(this);
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(
    function (this: HTMLElement) {
      let top = 0;
      for (let el = this.previousElementSibling; el; el = el.previousElementSibling)
        top += heightOf(el);
      return top;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function message(id: string, role: "user" | "assistant"): MastraDBMessage {
  return {
    id,
    role,
    createdAt: new Date("2026-09-16T12:00:00Z"),
    content: { format: 2, parts: [{ type: "text", text: `${role} ${id}` }] },
  } as unknown as MastraDBMessage;
}

/** `turns` user/assistant pairs: u1 a1 u2 a2 ... */
function thread(turns: number): ChatState {
  const messages = Array.from({ length: turns }, (_, i) => [
    message(`u${i + 1}`, "user"),
    message(`a${i + 1}`, "assistant"),
  ]).flat();
  return { ...emptyChatState(), messages };
}

function Section({
  id,
  register,
}: {
  id: string;
  register: (id: string, el: HTMLElement | null) => void;
}) {
  const ref = useCallback((el: HTMLElement | null) => register(id, el), [id, register]);
  return <section data-moment="" data-key={id} ref={ref} />;
}

function Harness({ state }: { state: ChatState }) {
  const lens = useLensModel({ state, mode: "threads" });
  return (
    <div ref={lens.frameRef}>
      <div ref={lens.scrollerRef} data-testid="scroller">
        <div ref={lens.stripRef} />
        <div ref={lens.chatRef} data-testid="chat">
          {lens.moments.map((moment) => (
            <Section key={moment.id} id={moment.id} register={lens.registerMoment} />
          ))}
        </div>
      </div>
    </div>
  );
}

function setup({ turn, loading }: { turn?: number; loading: boolean }) {
  const registry = AtomRegistry.make();
  const patches: { turn?: number }[] = [];
  const store = createChatPageStore({
    registry,
    search: {
      mode: "threads",
      turn,
      patch: async (partial) => void patches.push(partial),
    },
  });
  const bench = { store, currentThreadId: "t1", revit: false, loading };
  workbench.value = bench;
  let scrollTop = 0;
  const view = (state: ChatState) => (
    <RegistryContext.Provider value={registry}>
      <Harness state={state} />
    </RegistryContext.Provider>
  );
  const scroller = () => {
    const el = document.querySelector<HTMLElement>("[data-testid='scroller']")!;
    if (!Object.hasOwn(el, "scrollTop")) {
      const content = () =>
        [...el.querySelectorAll<HTMLElement>("[data-moment]")].reduce(
          (sum, m) => sum + heightOf(m),
          0,
        );
      Object.defineProperties(el, {
        clientHeight: { get: () => V },
        scrollHeight: { get: () => Math.max(V, content()) },
        scrollTop: {
          get: () => scrollTop,
          set: (value: number) => {
            scrollTop = Math.min(Math.max(0, value), Math.max(0, content() - V));
          },
        },
      });
    }
    return el;
  };
  return { registry, store: store as ChatPageStore, patches, bench, view, scroller };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

test("open with ?turn lands on that turn once the thread has loaded", async () => {
  const lane = setup({ turn: 2, loading: true });
  const { rerender } = render(lane.view(emptyChatState()));
  lane.scroller();
  await flush();
  lane.bench.loading = false;
  rerender(lane.view(thread(3)));
  await flush();
  // turn 2's user row is the third moment: top 600, centered on the focal axis.
  expect(lane.scroller().scrollTop).toBe(600 - FOCAL_TOP);
});

test("following re-snaps when a message grows after render", async () => {
  const lane = setup({ loading: false });
  render(lane.view(thread(2)));
  const scroller = lane.scroller();
  await flush();
  expect(scroller.scrollTop).toBe(4 * H - V);
  // Highlighting finishes: the last message grows without a React render.
  heights.set("a2", 900);
  act(() => FakeResizeObserver.resize(document.querySelector("[data-testid='chat']")!));
  expect(scroller.scrollTop).toBe(3 * H + 900 - V);
});

test("a scrollTop drop the browser makes on its own does not detach follow", async () => {
  const lane = setup({ loading: false });
  render(lane.view(thread(3)));
  const scroller = lane.scroller();
  await flush();
  expect(scroller.scrollTop).toBe(6 * H - V);
  // A tool body collapses: the browser clamps scrollTop down and fires scroll. No user input.
  heights.set("a3", 100);
  scroller.scrollTop = 6 * H - V; // the browser clamps it to the shorter content
  act(() => void fireEvent.scroll(scroller));
  expect(lane.registry.get(lane.store.atoms.lensFollowing)).toBe(true);

  // A wheel up is intent: that detaches.
  act(() => {
    fireEvent.wheel(scroller, { deltaY: -200 });
    scroller.scrollTop = scroller.scrollTop - 400;
    fireEvent.scroll(scroller);
  });
  expect(lane.registry.get(lane.store.atoms.lensFollowing)).toBe(false);
});

test("the scroller never animates a programmatic snap", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "lens.css"), "utf8");
  expect(css).not.toMatch(/\[data-annotation="scroller"\]\s*\{[^}]*scroll-behavior:\s*smooth/);
});

test("a touch fling that coasts into the tail re-attaches follow when the scroll ends", async () => {
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const lane = setup({ loading: false });
  render(lane.view(thread(3)));
  const scroller = lane.scroller();
  await flush();
  act(() => {
    fireEvent.touchMove(scroller);
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
  });
  expect(lane.registry.get(lane.store.atoms.lensFollowing)).toBe(false);

  // A second fling: the finger lifts, and momentum carries the view down well past the window.
  act(() => void fireEvent.touchMove(scroller));
  now += 3000;
  act(() => {
    scroller.scrollTop = 6 * H - V;
    fireEvent.scroll(scroller);
  });
  expect(lane.registry.get(lane.store.atoms.lensFollowing)).toBe(false);
  act(() => void fireEvent(scroller, new Event("scrollend")));
  expect(lane.registry.get(lane.store.atoms.lensFollowing)).toBe(true);
});
