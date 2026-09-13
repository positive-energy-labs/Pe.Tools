// @vitest-environment jsdom
import { afterEach, expect, test } from "vite-plus/test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useTakeoffStore } from "./store";

class DeadSource {
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
(globalThis as { EventSource?: unknown }).EventSource = DeadSource;
afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

test("live Takeoffs initializes its declared Page defaults", () => {
  const { result } = renderHook(() => useTakeoffStore({}));
  expect(result.current.views).toEqual([]);
  expect(result.current.zones).toEqual([]);
  expect(result.current.r10Path).toBe("");
  expect(result.current.panel).toBeNull();
});

test("workspace selections feed action readiness and action navigation feeds the workspace", async () => {
  history.replaceState(null, "", "/takeoffs?demo=sync");
  const { result } = renderHook(() => useTakeoffStore({}));
  act(() => result.current.actions.setSelection({ zones: [], r10: "" }));
  expect(result.current.handle.page[0].zones).toEqual([]);
  expect(result.current.handle.actions.partition.refusal).toBe("Select zones to partition");
  expect(result.current.handle.actions.sync.refusal).toBe("Choose an .r10 file");
  act(() => result.current.actions.setSelection({ r10: "C:\\Projects\\projectA.r10" }));
  expect(result.current.handle.actions.sync.refusal).toBeNull();
  await act(async () => {
    await result.current.actions.openSync();
  });
  expect(result.current.panel).toBe("sync");
  // Opening the review is not permission to sync a seed's unversioned file.
  expect(result.current.handle.actions["commit-sync"].refusal).toBe(
    "Review sync before committing",
  );
  await act(async () => {
    await result.current.actions.syncRhvac();
  });
  expect(result.current.failure?.message).toBe("Review sync before committing");
  act(() => result.current.actions.openPanel(null));
  expect(result.current.handle.page[0].panel).toBeNull();
});
