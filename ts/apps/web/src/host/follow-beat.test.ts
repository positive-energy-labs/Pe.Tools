import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { followBeat, retryDelayMs } from "./resource-stream";

beforeEach(() => void vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("retry delays double from the base to the ceiling and jitter within the upper half", () => {
  const at = (random: number) =>
    [1, 2, 3, 4, 5, 6, 7].map((n) => retryDelayMs(n, 1000, 30_000, () => random));
  expect(at(1)).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  expect(at(0)).toEqual([500, 1000, 2000, 4000, 8000, 15_000, 15_000]);
});

test("a beat against a down host is bounded over 85 s, wakes on the stream's recovery, and returns to its period", async () => {
  // The least jitter is the most attempts: the bound holds for every draw.
  vi.spyOn(Math, "random").mockReturnValue(0);
  let down = true;
  let attempts = 0;
  let recovered = () => {};
  const stop = followBeat(
    async () => {
      attempts++;
      if (down) throw new TypeError("Failed to fetch");
    },
    5_000,
    { onResync: (listener) => ((recovered = listener), () => {}) },
  );
  await vi.advanceTimersByTimeAsync(85_000);
  // A fixed 5 s interval makes 18. Backed off: 0, 5, 15, 30, 45, 60 and 75 s.
  expect(attempts).toBe(7);
  down = false;
  recovered();
  await vi.advanceTimersByTimeAsync(0);
  expect(attempts).toBe(8);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(attempts).toBe(11);
  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(attempts).toBe(11);
});

/* B05 (kernel-journeys-focus): the 15 s view lease lapsed once its 5 s beat was chained on the answer. */
test("a healthy beat holds its period: from the send, however slow the answer, on the interval clock", async () => {
  let attempts = 0;
  // Each answer takes longer than the period, as a busy host's does.
  const slow = followBeat(
    () => (attempts++, new Promise((resolve) => setTimeout(resolve, 7_000))),
    5_000,
    {
      onResync: () => () => {},
    },
  );
  await vi.advanceTimersByTimeAsync(20_000);
  expect(attempts).toBe(5);
  slow();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(attempts).toBe(5);
  // A caller that advances only the interval clock still sees every period.
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  attempts = 0;
  const stop = followBeat(async () => void attempts++, 5_000, { onResync: () => () => {} });
  await vi.advanceTimersByTimeAsync(20_000);
  stop();
  expect(attempts).toBe(5);
});
