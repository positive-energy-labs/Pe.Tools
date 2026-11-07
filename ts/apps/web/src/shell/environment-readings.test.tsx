// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { Machine, ReadingRequest } from "@pe/agent-contracts";
import { useEnvironmentReading } from "../host/environment-state";
const selection = vi.hoisted(() => ({ name: "missing", calls: [] as (ReadingRequest | null)[] }));
vi.mock("../route/activity", () => ({
  useRouteSearchSlice: (select: (search: Record<string, unknown>) => unknown) =>
    select({ fixture: selection.name }),
}));
vi.mock("../host/resource-state", () => ({
  useReadingSlice: (
    request: ReadingRequest | null,
    select: (reading: { state: "absent" }) => unknown,
  ) => {
    selection.calls.push(request);
    return select({ state: "absent" });
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("chrome switches seeded readings and refuses missing seeds without a native subscription", async () => {
  const fetch = vi.fn(() => {
    throw Error("Real transport reached");
  });
  vi.stubGlobal("fetch", fetch);
  selection.name = "missing";
  selection.calls.length = 0;
  const hook = renderHook(() => useEnvironmentReading<Machine>({ kind: "machine" }));
  await waitFor(() => expect(hook.result.current.reading.state).toBe("failed"));
  selection.name = "refresh";
  hook.rerender();
  await waitFor(() => expect(hook.result.current.reading.state).toBe("ready"));
  selection.name = "";
  hook.rerender();
  expect(hook.result.current.reading.state).toBe("absent");
  await waitFor(() => expect(hook.result.current.reading.state).toBe("failed"));
  expect(hook.result.current.remote).toBe(false);
  expect(selection.calls.every((request) => request === null)).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

test("companion transcript is a declared fixture reading on tool routes", async () => {
  selection.name = "scene";
  const fetch = vi.fn(() => {
    throw Error("Real transport reached");
  });
  vi.stubGlobal("fetch", fetch);
  const hook = renderHook(() => useEnvironmentReading(null, "transcript"));
  await waitFor(() => expect(hook.result.current.reading.state).toBe("ready"));
  expect(hook.result.current.remote).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
