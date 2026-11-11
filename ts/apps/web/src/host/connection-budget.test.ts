// @vitest-environment jsdom
/**
 * The host listens with node:http (HTTP/1.1, apps/host/src/app.ts), so a browser gives the whole
 * origin 6 sockets, shared by every tab and by pages held in the back/forward cache. Each open
 * EventSource holds one for as long as it lives. The file header of resource-stream.ts says "One
 * EventSource per tab"; `openEventSource` lets every host read open its own.
 *
 * Measured 2026-11-11 on Chrome 157 against a node:http server: beside a tab holding 5 streams, a
 * second tab's fetch never left the browser; a page navigated away kept its 5 streams for 60.06 s,
 * and the next page's fetch waited those 60.06 s; a reload freed them in 20 ms. The drive's host
 * log at ef940d36 shows /ducts holding 1 `/pe/resources` and 4 `/pe/read-events`.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { ReadingContext } from "../shell/source-contract";
import { publicationSource } from "./publication-source";
import { PeReadings } from "./resource-stream";

afterEach(() => vi.unstubAllGlobals());

test.fails("a tab's host reads ride its one stream, so they hold no more of the origin's 6 sockets", async () => {
  const live = new Set<string>();
  vi.stubGlobal("EventSource", class {
    onopen = null; onmessage = null; onerror = null;
    constructor(readonly url: string) { live.add(url); }
    close() { live.delete(this.url); }
  });
  // The census: the inventory reading behind "Finding the open document".
  const readings = new PeReadings(() => "http://127.0.0.1/pe/resources", undefined, undefined, async () => {});
  readings.subscribe({ kind: "inventory" }, () => {});
  await vi.waitFor(() => expect(live.size).toBe(1));
  // /ducts mounts 4 host reads.
  const stops = Array.from({ length: 4 }, () => publicationSource({
    read: async (_ctx, publication) => ({ generation: publication.generation, version: 1, state: "current",
      value: { evaluation: "e", coverage: { refused: [], unknown: [] } } }),
  }).open({ signal: new AbortController().signal } as ReadingContext, () => {}));
  try {
    await new Promise(done => setTimeout(done, 50));
    expect([...live].map(url => new URL(url, "http://127.0.0.1").pathname)).toEqual(["/pe/resources"]);
  } finally {
    for (const stop of stops) if (typeof stop === "function") stop();
    readings.close();
  }
});
