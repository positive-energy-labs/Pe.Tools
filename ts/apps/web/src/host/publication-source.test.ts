import { expect, test } from "vite-plus/test";
import { publicationSource } from "./publication-source";

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
