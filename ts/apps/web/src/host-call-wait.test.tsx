// @vitest-environment jsdom
/** F-J1-4: a host read that never answers ends honestly, never as an endless "reading…". */
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { useHostCall } from "#/readings";
import { HOST_READ_WAIT_S } from "#/route/waits";

afterEach(() => vi.useRealTimers());

test("an unanswered host read ends as 'no answer after Ns' and aborts", async () => {
  vi.useFakeTimers();
  let aborted = false;
  const { result } = renderHook(() =>
    useHostCall(
      (signal) =>
        new Promise<never>(() => {
          signal.addEventListener("abort", () => (aborted = true));
        }),
      ["never"],
    ),
  );
  expect(result.current.pending).toBe(true);
  await act(async () => vi.advanceTimersByTime(HOST_READ_WAIT_S * 1000 + 10));
  expect(result.current.pending).toBe(false);
  expect(result.current.error?.message).toBe(`no answer after ${HOST_READ_WAIT_S}s`);
  expect(aborted).toBe(true);
});

test("an answer inside the wait is kept, and the wait never fires after it", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useHostCall(async () => "ok", ["fast"]));
  await act(async () => {});
  expect(result.current.data).toBe("ok");
  await act(async () => vi.advanceTimersByTime(HOST_READ_WAIT_S * 1000 + 10));
  expect(result.current.error).toBeUndefined();
  expect(result.current.data).toBe("ok");
});
