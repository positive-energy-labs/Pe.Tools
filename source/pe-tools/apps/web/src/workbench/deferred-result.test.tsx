// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import type { ToolCall } from "./chat-state";
import {
  deferredResultSummary,
  loadDeferredToolResult,
  useDeferredToolResult,
} from "./deferred-result";
import { WorkbenchContext } from "./provider/thread-summary";

const ref = {
  messageId: "message/1",
  toolCallId: "call/1",
  byteSize: 70_000,
  summary: { kind: "array" as const, items: 2 },
};
const call: ToolCall = {
  id: ref.toolCallId,
  parentMessageId: ref.messageId,
  title: "pe_read",
  args: {},
  images: [],
  status: "completed",
};

function Probe({ enabled }: { enabled: boolean }) {
  const result = useDeferredToolResult(call, enabled);
  return <span>{result.pending ? "loading" : JSON.stringify(result.result)}</span>;
}

const context = (threadId: string) =>
  ({
    chat: { deferredResults: [ref] },
    config: { origin: "http://host" },
    currentThreadId: threadId,
  }) as never;

test("closed results make no request and opening loads the exact result", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(
        JSON.stringify({ messageId: ref.messageId, toolCallId: ref.toolCallId, result: [1, 2] }),
      ),
    );
  const view = render(
    <WorkbenchContext.Provider value={context("thread/1")}>
      <Probe enabled={false} />
    </WorkbenchContext.Provider>,
  );
  expect(fetch).not.toHaveBeenCalled();

  view.rerender(
    <WorkbenchContext.Provider value={context("thread/1")}>
      <Probe enabled />
    </WorkbenchContext.Provider>,
  );
  await waitFor(() => expect(view.container.textContent).toBe("[1,2]"));
  expect(fetch).toHaveBeenCalledWith(
    "http://host/pe/thread/thread%2F1/tool-result/message%2F1/call%2F1",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  fetch.mockRestore();
});

test("the loader rejects a response for another call", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify({ messageId: ref.messageId, toolCallId: "other", result: [] })),
    );
  await expect(
    loadDeferredToolResult("", "thread", ref, new AbortController().signal),
  ).rejects.toThrow("identity did not match");
  fetch.mockRestore();
});

test("structural summaries stay compact", () => {
  expect(deferredResultSummary({ kind: "object", keyCount: 12, keys: ["rows", "total"] })).toBe(
    "rows, total",
  );
  expect(deferredResultSummary({ kind: "string", characters: 90_000 })).toBe("90000 characters");
});

test("changing threads aborts the in-flight request", async () => {
  const signals: AbortSignal[] = [];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
    const signal = init?.signal as AbortSignal;
    signals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  });
  const view = render(
    <WorkbenchContext.Provider value={context("thread-a")}>
      <Probe enabled />
    </WorkbenchContext.Provider>,
  );
  await waitFor(() => expect(signals).toHaveLength(1));
  view.rerender(
    <WorkbenchContext.Provider value={context("thread-b")}>
      <Probe enabled />
    </WorkbenchContext.Provider>,
  );
  await waitFor(() => expect(signals[0].aborted).toBe(true));
  fetch.mockRestore();
});
