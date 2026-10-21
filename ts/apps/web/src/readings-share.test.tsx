// @vitest-environment jsdom
/** A remount asking the same op joins the call in flight; a refresh starts a fresh one. */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { useHostCall } from "./readings";

afterEach(cleanup);

test("equal shared deps share one call in flight; refresh calls again; unshared never share", async () => {
  let calls = 0;
  let release!: (v: string) => void;
  const run = () => {
    calls++;
    return new Promise<string>((resolve) => (release = resolve));
  };
  const a = renderHook(() => useHostCall(run, ["op", "same"], true, 60, true));
  a.unmount(); // a remount: the call stays in flight
  const b = renderHook(() => useHostCall(run, ["op", "same"], true, 60, true));
  expect(calls).toBe(1);
  await act(async () => release("x"));
  await waitFor(() => expect(b.result.current.data).toBe("x"));
  act(() => b.result.current.refresh());
  expect(calls).toBe(2);
  renderHook(() => useHostCall(run, ["op", "same"], true, 60));
  renderHook(() => useHostCall(run, ["op", "same"], true, 60));
  expect(calls).toBe(4);
});
