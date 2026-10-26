import { afterEach, expect, test, vi } from "vite-plus/test";
import { adaptiveWork, workerBenefit } from "../src/adaptive-work.ts";

afterEach(() => vi.useRealTimers());

test("admission rejects short, drained, cached and already-full queues", () => {
  expect(workerBenefit([60_000, 60_000, 60_000], 1, 0, 180_000)).toBe(false);
  expect(workerBenefit(Array(28).fill(2_000), 1, 0, 180_000)).toBe(false);
  expect(workerBenefit(Array(100).fill(0), 1, 0, 180_000)).toBe(false);
  expect(workerBenefit(Array(100).fill(60_000), 1, 2, 180_000)).toBe(false);
  expect(workerBenefit(Array(20).fill(60_000), 1, 0, 180_000)).toBe(true);
  expect(workerBenefit(Array(20).fill(60_000), 1, 1, 180_000)).toBe(true);
});

test("idle workers pull the tail, every result lands once, and owned executors close", async () => {
  vi.useFakeTimers();
  const completed: number[] = [],
    used = new Set<number>(),
    disposed: number[] = [];
  let next = 1;
  const executor = (id: number) => ({
    run: async (item: number) => {
      used.add(id);
      await new Promise((r) => setTimeout(r, item === 0 ? 300_000 : 60_000));
      return item;
    },
    dispose: async () => {
      disposed.push(id);
    },
  });
  const running = adaptiveWork({
    items: Array.from({ length: 24 }, (_, i) => i),
    primary: executor(0),
    acquire: async (useful) => {
      const id = next++;
      await new Promise((r) => setTimeout(r, 180_000));
      return useful() ? executor(id) : null;
    },
    cost: () => 60_000,
    startupMs: () => 180_000,
    canExpand: () => true,
    cancelled: () => false,
    completed: async (_, value) => {
      completed.push(value);
    },
    warning: (error) => {
      throw error;
    },
  });
  await vi.runAllTimersAsync();
  await running;
  expect(completed.sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  expect(used.size).toBe(3);
  expect(disposed.sort()).toEqual([1, 2]);
});

test("a failed worker returns its unfinished item to the queue without duplicating completed rows", async () => {
  vi.useFakeTimers();
  const completed: number[] = [],
    disposed: number[] = [];
  let worker = 0;
  const running = adaptiveWork({
    items: Array.from({ length: 20 }, (_, i) => i),
    primary: {
      run: async (item: number) => {
        await new Promise((r) => setTimeout(r, 60_000));
        return item;
      },
      dispose: async () => {},
    },
    acquire: async () => {
      const id = ++worker;
      return {
        run: async () => {
          throw Error("lost bridge");
        },
        dispose: async () => {
          disposed.push(id);
        },
      };
    },
    cost: () => 60_000,
    startupMs: () => 1_000,
    canExpand: () => true,
    cancelled: () => false,
    completed: async (_, value) => {
      completed.push(value);
    },
    warning: () => {},
  });
  await vi.runAllTimersAsync();
  await running;
  expect(new Set(completed).size).toBe(20);
  expect(completed.length).toBe(20);
  expect(disposed).toHaveLength(2);
});

test("cancel stops assignment at the next family boundary", async () => {
  let cancelled = false;
  const completed: number[] = [];
  await adaptiveWork({
    items: [1, 2, 3, 4, 5],
    primary: { run: async (n) => n, dispose: async () => {} },
    acquire: async () => {
      throw Error("unused worker");
    },
    cost: () => 1,
    startupMs: () => 180_000,
    canExpand: () => false,
    cancelled: () => cancelled,
    completed: async (_, n) => {
      completed.push(n);
      if (n === 2) cancelled = true;
    },
    warning: () => {},
  });
  expect(completed).toEqual([1, 2]);
});

test("a result publication failure cannot silently lose a worker's completed item", async () => {
  let disposed = false;
  await expect(
    adaptiveWork({
      items: Array.from({ length: 10 }, (_, i) => i),
      primary: { run: async (n: number) => n, dispose: async () => {} },
      acquire: async () => ({
        run: async (n: number) => n,
        dispose: async () => {
          disposed = true;
        },
      }),
      cost: () => 60_000,
      startupMs: () => 1000,
      canExpand: () => true,
      cancelled: () => false,
      completed: async (n) => {
        if (n > 0) throw Error("disk unavailable");
      },
      warning: () => {},
    }),
  ).rejects.toThrow("disk unavailable");
  expect(disposed).toBe(true);
});
