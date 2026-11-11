import { expect, test } from "vite-plus/test";
import { publicationSource } from "./publication-source";

const value = { evaluation: "e1", coverage: { refused: [], unknown: [] } };
const raced = { generation: 0, version: 0, state: "refresh-needed", value: null,
  reason: 'resource {"kind":"machine"} changed during evaluation' };
const open = (answers: object[]) => {
  const frames: { kind: string; error?: unknown; reason?: string }[] = [];
  let reads = 0;
  const source = publicationSource({ read: async (_ctx, _publication, release) =>
    (release ? raced : answers[Math.min(reads++, answers.length - 1)]) as typeof raced });
  // A history point opens no event stream, so the source is driven by its reads alone.
  const stop = source.open({ signal: new AbortController().signal, historyPoint: {} } as never, frame => frames.push(frame as never)) as () => void;
  return { frames, stop, reads: () => reads };
};

test("a read that raced an input change is re-read, not shown as the host's internal reason", async () => {
  const run = open([raced, { generation: 0, version: 1, state: "current", value }]);
  await expect.poll(() => run.frames.at(-1)?.kind, { timeout: 5_000 }).toBe("complete");
  expect(run.frames.filter(frame => frame.kind === "failure")).toEqual([]);
  run.stop();
});

test("a read that keeps refusing settles on its failure after a bounded number of re-reads", async () => {
  const run = open([raced]);
  await expect.poll(() => run.frames.at(-1)?.kind, { timeout: 5_000 }).toBe("failure");
  expect(run.reads()).toBe(3);
  await new Promise(resolve => setTimeout(resolve, 1_000));
  expect(run.reads()).toBe(3);
  run.stop();
});
