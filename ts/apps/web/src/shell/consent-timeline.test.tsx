// @vitest-environment jsdom
import { test, expect, vi } from "vite-plus/test";
import { act, fireEvent, render, cleanup } from "@testing-library/react";
import { TimelineHead } from "./situation-band";
import { createRouteTimeline } from "./timeline";
const permission = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("#/workbench/provider/harness-client", () => ({ harnessClient: () => ({ permission }) }));

test("D8: a head mounted long before a window opens counts the host's 60 s, and a resolved window leaves at once", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const timeline = createRouteTimeline();
    const owner = {
      timeline, fixture: null, verbs: {}, subscribe: () => () => {}, version: () => 0,
      snapshot: () => ({}), journals: new Map(),
    } as never;
    const ui = render(<TimelineHead owner={owner} history={null} thread="t" />);
    // Minutes pass with no window open, so no interval ever ran (a throttled tab).
    vi.setSystemTime(Date.now() + 133_000);
    const receipt = { id: "apply-1", caller: { kind: "pea", thread: "originating-thread" } };
    const consentWindow = { requestId: "ask-1", deadline: new Date(Date.now() + 60_000).toISOString() };
    act(() => timeline.append({ kind: "receipt", at: Date.now(), verb: "apply", basis: { receipt },
      outcome: { id: "apply-1", receiptId: "apply-1", state: "queued", input: {}, consentWindow } }));
    fireEvent.click(ui.getByRole("button", { name: "Reject apply" }));
    expect(permission).toHaveBeenCalledWith("originating-thread", "ask-1", "stop_writes");
    expect(ui.getByRole("timer").textContent).toBe("apply · 60s");
    // Rejected: the cancelled receipt still carries the window it was stamped with.
    act(() => timeline.append({ kind: "receipt", at: Date.now(), verb: "apply", basis: { receipt },
      outcome: { id: "apply-1", receiptId: "apply-1", state: "cancelled", input: {}, consentWindow } }));
    expect(ui.queryByRole("timer")).toBeNull();
    expect(ui.queryByRole("button", { name: "Reject apply" })).toBeNull();
  } finally {
    vi.useRealTimers();
    cleanup();
  }
});

test("History records a write receipt and caller once rather than echoing its invocation", async () => {
  const { GraphHistory } = await import("./graph-history");
  const timeline = createRouteTimeline();
  const outcome = { id: "write-1", receiptId: "write-1", state: "cancelled" as const, input: {},
    consentWindow: { requestId: "ask-1", deadline: new Date(Date.now() + 60_000).toISOString() } };
  timeline.append({ kind: "invocation", at: Date.now(), press: "p1", verb: "apply", outcome });
  timeline.append({ kind: "receipt", at: Date.now(), press: "p1", verb: "apply", outcome,
    basis: { receipt: { id: "write-1", caller: { kind: "pea", thread: "t1" } } } });
  const owner = { timeline, verbs: { apply: { label: "Write to Revit" } },
    subscribe: () => () => {}, version: () => 0, snapshot: () => ({}), journals: new Map() } as never;
  const ui = render(<GraphHistory owner={owner} />);
  expect(ui.getAllByRole("option")).toHaveLength(1);
  expect(ui.getByRole("option").textContent).toContain("Pea");
  expect(ui.getByRole("option").textContent).toContain("cancelled");
  expect(ui.getByRole("option").textContent).not.toContain("Consent open");
  cleanup();
});

test("opening Timeline leaves undo and redo only in the top bar", async () => {
  const { GraphHistory } = await import("./graph-history");
  const owner = {
    timeline: () => [], journal: () => ({ revision: 0, undo: [], redo: [], moves: [] }),
    subscribe: () => () => {}, revision: () => 0, journalRefusal: () => null,
    restoreWork: vi.fn(),
  } as never;
  const ui = render(<TimelineHead owner={owner} history={<GraphHistory owner={owner} />} />);
  fireEvent.click(ui.getByRole("button", { name: "Open the Timeline" }));
  expect(ui.getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  expect(ui.getAllByRole("button", { name: "Redo" })).toHaveLength(1);
  cleanup();
});
