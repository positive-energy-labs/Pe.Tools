// @vitest-environment jsdom
/**
 * The host listens with node:http (HTTP/1.1, apps/host/src/app.ts), so a browser gives the whole
 * origin 6 sockets, shared by every tab and by pages held in the back/forward cache. Each open
 * EventSource holds one for as long as it lives. So a tab holds exactly one, whatever it shows:
 * every push is a Reading kind on `/pe/resources`, and a hidden page releases even that one.
 *
 * Measured 2026-11-11 on Chrome 157 against a node:http server: beside a tab holding 5 streams, a
 * second tab's fetch never left the browser; a page navigated away kept its 5 streams for 60.06 s,
 * and the next page's fetch waited those 60.06 s; a reload freed them in 20 ms. The drive's host
 * log at ef940d36 shows /ducts holding 1 `/pe/resources` and 4 `/pe/read-events` (a stream per
 * host read, since folded into the readings stream as the `publication` kind).
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { ReadingContext } from "../shell/source-contract";
import { publicationSource } from "./publication-source";
import { PeReadings, peReadings } from "./resource-stream";

afterEach(() => vi.unstubAllGlobals());

const live = new Set<string>();
class Stream {
  onopen = null; onmessage = null; onerror = null;
  constructor(readonly url: string) { live.add(url); }
  close() { live.delete(this.url); }
}
const paths = () => [...live].map(url => new URL(url, "http://127.0.0.1").pathname);

test("a tab's host reads ride its one stream, so they hold no more of the origin's 6 sockets", async () => {
  vi.stubGlobal("EventSource", Stream);
  // The census: the inventory reading behind "Finding the open document", on the tab's owner.
  const census = peReadings.subscribe({ kind: "inventory" }, () => {});
  await vi.waitFor(() => expect(live.size).toBe(1));
  // /ducts mounts 4 host reads.
  const stops = Array.from({ length: 4 }, () => publicationSource({
    read: async (_ctx, publication) => ({ generation: publication.generation, version: 1, state: "current",
      value: { evaluation: "e", coverage: { refused: [], unknown: [] } } }),
  }).open({ signal: new AbortController().signal } as ReadingContext, () => {}));
  try {
    await new Promise(done => setTimeout(done, 50));
    expect(paths()).toEqual(["/pe/resources"]);
  } finally {
    for (const stop of stops) if (typeof stop === "function") stop();
    census();
  }
});

test("a page that leaves view frees its socket at once, and takes one again when it shows", async () => {
  // This owner's own sockets, apart from the tab owner the first test used.
  const held = new Set<string>();
  const connect = (url: string) => {
    held.add(url);
    return { onopen: null, onmessage: null, onerror: null, close: () => void held.delete(url) };
  };
  const frames: string[] = [];
  const readings = new PeReadings(() => "http://127.0.0.1/pe/resources", connect, undefined, async () => {});
  readings.subscribe({ kind: "inventory" }, frame => frames.push(frame.kind));
  try {
    await vi.waitFor(() => expect(held.size).toBe(1));
    const [first] = held;
    // Navigating away may park the page in the back/forward cache; its stream must not stay.
    window.dispatchEvent(new Event("pagehide"));
    expect(held.size).toBe(0);
    // Nothing reopens it while hidden, not a new key and not a retry.
    readings.subscribe({ kind: "machine" }, () => {});
    await new Promise(done => setTimeout(done, 50));
    expect(held.size).toBe(0);
    window.dispatchEvent(new Event("pageshow"));
    // A new connection: every key is reacquired, and what was held is fenced until then.
    expect(held.size).toBe(1);
    expect([...held][0]).not.toBe(first);
    expect(frames.at(-1)).toBe("stale");
  } finally {
    readings.close();
  }
  expect(held.size).toBe(0);
});
