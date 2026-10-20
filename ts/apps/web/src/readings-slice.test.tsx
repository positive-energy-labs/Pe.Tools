// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { readingKey, type ReadingFrame } from "@pe/agent-contracts";

import { useReadingSlice, type Readings } from "./readings";

afterEach(cleanup);

test("a frame that leaves the selected slice equal does not re-render the reader", () => {
  const accepts: Array<(frame: ReadingFrame) => void> = [];
  const source = {
    subscribe: (_request, accept) => {
      accepts.push(accept as never);
      return () => {};
    },
    dirty: () => {},
  } as Readings;
  const key = readingKey({ kind: "host-status" });
  const frame = (value: unknown) => ({ kind: "snapshot", key, value }) as unknown as ReadingFrame;
  let renders = 0;
  const { result } = renderHook(() => {
    renders++;
    return useReadingSlice<{ n: number; tick: number }, boolean | undefined>(
      { kind: "host-status" },
      (reading) => (reading.state === "ready" ? reading.observation.n > 0 : undefined),
      source,
    );
  });
  act(() => accepts.forEach((accept) => accept(frame({ n: 1, tick: 1 }))));
  expect(result.current).toBe(true);
  const settled = renders;
  act(() => accepts.forEach((accept) => accept(frame({ n: 2, tick: 2 }))));
  expect(renders).toBe(settled);
  act(() => accepts.forEach((accept) => accept(frame({ n: 0, tick: 3 }))));
  expect(result.current).toBe(false);
});
