import { expect, test, vi } from "vite-plus/test";
import { publicationSource } from "./publication-source";

const stream = vi.hoisted(() => ({ listener: undefined as ((frame: unknown) => void) | undefined }));
vi.mock("./resource-stream", () => ({
  peReadings: { subscribe: (_request: unknown, listener: (frame: unknown) => void) => { stream.listener = listener; return () => {}; } },
}));

// The host re-evaluates a raced read itself (host tests: resource-content-http), so its refusal lasts.
test("a refusal with nothing retained is shown once with the host's reason; the source does not re-read", async () => {
  const refused = { generation: 0, version: 0, state: "refresh-needed", value: null,
    reason: "The machine input changed while this was being read." };
  const frames: { kind: string; error?: unknown }[] = [];
  let reads = 0;
  const source = publicationSource({ read: async (_ctx, _publication, release) => { if (!release) reads++; return refused; } });
  // A history point opens no event stream, so the source is driven by its reads alone.
  const stop = source.open({ signal: new AbortController().signal, historyPoint: {} } as never, frame => frames.push(frame as never)) as () => void;
  await expect.poll(() => frames.at(-1)).toEqual({ kind: "failure", error: refused.reason });
  await new Promise(resolve => setTimeout(resolve, 600));
  expect(reads).toBe(1);
  stop();
});

// A host restart under a live tab: the stream reconnects and the new host, holding no slot, answers
// the subscription `absent` (builtin-inputs.ts). The drawn value is no longer anyone's publication.
test("a live publication answered `absent` goes stale and is re-read, never kept current", async () => {
  const value = { evaluation: "e1", coverage: { refused: [], unknown: [] } };
  const frames: { kind: string }[] = [];
  let reads = 0;
  const source = publicationSource({ read: async (_ctx, _publication, release) => {
    if (!release) reads++;
    return { generation: 0, version: reads, state: "current", value };
  } });
  const stop = source.open({ signal: new AbortController().signal } as never, frame => frames.push(frame as never)) as () => void;
  await expect.poll(() => stream.listener).toBeDefined();
  expect(frames.map(frame => frame.kind)).toEqual(["complete"]);
  stream.listener!({ kind: "snapshot", key: "k", value: { generation: 0, version: 0, state: "absent" } });
  await expect.poll(() => frames.map(frame => frame.kind)).toEqual(["complete", "stale", "complete"]);
  expect(reads).toBe(2);
  stop();
});

test("a refusal holds no value, so its `absent` answer is no news: one read", async () => {
  const frames: { kind: string }[] = [];
  let reads = 0;
  stream.listener = undefined;
  const source = publicationSource({ read: async (_ctx, _publication, release) => {
    if (!release) reads++;
    return { generation: 0, version: 0, state: "refresh-needed", value: null, reason: "Refused." };
  } });
  const stop = source.open({ signal: new AbortController().signal } as never, frame => frames.push(frame as never)) as () => void;
  await expect.poll(() => stream.listener).toBeDefined();
  stream.listener!({ kind: "snapshot", key: "k", value: { generation: 0, version: 0, state: "absent" } });
  await new Promise(resolve => setTimeout(resolve, 100));
  expect([reads, frames.map(frame => frame.kind)]).toEqual([1, ["failure"]]);
  stop();
});
