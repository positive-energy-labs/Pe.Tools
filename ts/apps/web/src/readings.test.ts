// @vitest-environment node
import { expect, test, vi } from "vite-plus/test";

import { PeReadings } from "./readings";

test("a subscribe during prerender (no window) never opens a stream", async () => {
  const connect = vi.fn();
  const readings = new PeReadings(() => "http://127.0.0.1:5180/readings", connect as never);
  readings.subscribe({ kind: "machine" }, () => {});
  await Promise.resolve();
  expect(typeof window).toBe("undefined");
  expect(connect).not.toHaveBeenCalled();
});
