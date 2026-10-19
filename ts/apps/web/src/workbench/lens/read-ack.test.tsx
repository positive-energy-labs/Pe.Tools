// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { emptyChatState } from "@pe/agent-contracts/chat-state";
import { Lens } from "./view";

const wire = vi.hoisted(() => ({
  update: vi.fn(),
  scroller: { current: null as HTMLDivElement | null },
  threads: [] as import("@pe/agent-contracts").HarnessThreadSummary[],
}));
vi.mock("../provider", () => ({
  useWorkbench: () => ({ updateThread: wire.update, threads: wire.threads }),
}));
vi.mock("../moments", () => ({ Moments: () => null }));
vi.mock("./model", () => ({
  useLensModel: () => ({
    messages: [],
    moments: [],
    showEmpty: false,
    cache: { changed: new Set() },
    scrollerRef: wire.scroller,
    bandRefs: { current: new Map() },
    registerMoment: () => {},
    onBandClick: () => {},
  }),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  wire.update.mockReset();
  wire.threads = [];
});

test("a scheduled read keeps its observed revision, summary refresh does not clear unread, revisit acknowledges it", async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  const initial = {
    ...emptyChatState(),
    id: "one",
    activity: { ...emptyChatState().activity, lastSeq: 1 },
    events: [
      {
        kind: "turn_end" as const,
        turnId: "done",
        stopReason: "end_turn",
        seq: 1,
        at: "2026-10-11",
      },
    ],
  };
  const marked = {
    ...initial,
    lifecycle: { ...initial.lifecycle, revision: 1, explicitUnread: true },
  };
  const screen = render(<Lens state={initial} />);
  screen.rerender(<Lens state={marked} />);
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(wire.update).toHaveBeenCalledExactlyOnceWith("one", { expectedRevision: 0, readSeq: 1 });
  screen.rerender(<Lens state={{ ...marked, lifecycle: { ...marked.lifecycle, revision: 2 } }} />);
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(wire.update).toHaveBeenCalledTimes(1);
  screen.rerender(<Lens state={{ ...initial, id: "two" }} />);
  screen.rerender(<Lens state={marked} />);
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(wire.update).toHaveBeenLastCalledWith("one", { expectedRevision: 1, readSeq: 1 });
});
test("an empty-thread revisit clears explicit unread with watermark zero, while same-visit refresh keeps it", async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  const empty = { ...emptyChatState(), id: "one" };
  const marked = { ...empty, lifecycle: { ...empty.lifecycle, revision: 1, explicitUnread: true } };
  const screen = render(<Lens state={empty} />);
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(wire.update).toHaveBeenCalledExactlyOnceWith("one", { expectedRevision: 0, readSeq: 0 });
  wire.threads = [marked];
  screen.rerender(<Lens state={marked} />);
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(wire.update).toHaveBeenCalledTimes(1);
  screen.rerender(<Lens state={{ ...empty, id: "two" }} />);
  screen.rerender(<Lens state={marked} />);
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(wire.update).toHaveBeenLastCalledWith("one", { expectedRevision: 1, readSeq: 0 });
});

test("completion waits for a matching fresh summary and captures its current lifecycle revision", async () => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  const body = {
    ...emptyChatState(),
    id: "one",
    events: [
      {
        kind: "turn_end" as const,
        turnId: "done",
        stopReason: "end_turn",
        seq: 1,
        at: "2026-10-11",
      },
    ],
  };
  const screen = render(<Lens state={body} />);
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(wire.update).not.toHaveBeenCalled();
  wire.threads = [
    {
      ...body,
      lifecycle: { ...body.lifecycle, revision: 4 },
      activity: { ...body.activity, lastSeq: 1 },
    },
  ];
  screen.rerender(<Lens state={body} />);
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(wire.update).toHaveBeenCalledExactlyOnceWith("one", { expectedRevision: 4, readSeq: 1 });
});
