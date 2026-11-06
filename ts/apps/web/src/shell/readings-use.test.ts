import { expect, test, vi } from "vite-plus/test";
import type { ReadingContext, ReadingDelivery } from "./readings";
import { acquireSource, openSourceReading } from "./readings-use";

test("only a fresh complete source publication is current, and close fences late output", () => {
  let publish!: ReadingDelivery;
  const delivered = vi.fn();
  const close = openSourceReading({ kind: "use", open(_ctx, accept) { publish = accept; } }, context(), delivered);
  publish({ kind: "part", value: 1, revision: 1 });
  expect(delivered.mock.calls.at(-1)![0]).toMatchObject({ current: false });
  publish({ kind: "complete", value: 2, revision: 2, fresh: false });
  expect(delivered.mock.calls.at(-1)![0]).toMatchObject({ current: false });
  publish({ kind: "complete", value: 3, revision: 3 });
  expect(delivered.mock.calls.at(-1)![0]).toMatchObject({ current: true });
  publish({ kind: "stale" });
  expect(delivered.mock.calls.at(-1)![0]).toMatchObject({ current: false });
  publish({ kind: "failure", error: "failed" });
  expect(delivered.mock.calls.at(-1)![0]).toMatchObject({ current: false });
  const before = delivered.mock.calls.length;
  close(); publish({ kind: "complete", value: 4, revision: 4 });
  expect(delivered).toHaveBeenCalledTimes(before);
});

function context(controller = new AbortController()): ReadingContext {
  return {
    target: { kind: "host" },
    workKey: null,
    workRevision: null,
    work: null,
    page: {},
    args: {},
    inputs: {},
    attempt: { target: { kind: "host" }, workKey: null, generation: 1 },
    trigger: { kind: "demand" },
    signal: controller.signal,
  };
}

test("a synchronous completion releases even an asynchronously returned lease before resolving", async () => {
  const release = vi.fn();
  await acquireSource(
    {
      kind: "use",
      async open(_context, deliver) {
        deliver({ kind: "complete", value: 1, revision: 0 });
        return release;
      },
    },
    context(),
  );
  expect(release).toHaveBeenCalledTimes(1);
});

test("only a fresh completion settles an acquisition, and later frames cannot complete it again", async () => {
  let deliver!: ReadingDelivery<number>;
  const release = vi.fn();
  const result = acquireSource<number>(
    {
      kind: "use",
      open(_context, accept) {
        deliver = accept;
        accept({ kind: "part", value: 0, revision: 0 });
        accept({ kind: "complete", value: 1, revision: 1, fresh: false });
        return release;
      },
    },
    context(),
  );
  await Promise.resolve();
  expect(release).not.toHaveBeenCalled();
  deliver({ kind: "complete", value: 2, revision: 2 });
  deliver({ kind: "complete", value: 3, revision: 3 });
  expect((await result).value).toBe(2);
  expect(release).toHaveBeenCalledTimes(1);
});

test("cancellation rejects promptly and releases a lease that arrives after cancellation", async () => {
  const controller = new AbortController();
  const release = vi.fn();
  let opened!: (release: () => void) => void;
  const result = acquireSource(
    {
      kind: "use",
      open: () => new Promise<() => void>((resolve) => (opened = resolve)),
    },
    context(controller),
  );
  await Promise.resolve();
  const rejected = expect(result).rejects.toThrow("Stopped");
  controller.abort(Error("Stopped"));
  await rejected;
  opened(release);
  await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
});
