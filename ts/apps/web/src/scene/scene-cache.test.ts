import { describe, expect, it } from "vite-plus/test";
import { SceneCache, sceneAdmissionBytes, type SceneData } from "./scene-cache";
import { SceneMemory } from "./scene-memory";

const scene = (epoch = 1, document = "a", builtUtc = "now", sourceEpoch = epoch): SceneData => ({
  positions: new Float32Array(9),
  metadata: {
    stamp: {
      epoch,
      hostDocumentKey: document,
      builtUtc,
      sources: [
        { documentKey: document, linkInstanceId: null, builtAtEpoch: sourceEpoch, dirty: false },
      ],
    },
    elements: [],
  } as unknown as SceneData["metadata"],
});

describe("resident Space scopes", () => {
  it("reuses exact arrays and evicts least recently visited scopes", () => {
    const cache = new SceneCache(
      new SceneMemory({ maxAdmissionBytes: 10000, maxDecodedScenes: 2 }),
    );
    const a = cache.put("a", scene());
    expect(Object.keys(a)).toEqual(["id", "bytes"]);
    cache.put("b", scene());
    expect(cache.get("a")).toBe(a);
    cache.put("c", scene());
    expect([...cache.entries.keys()]).toEqual(["a", "c"]);
  });
  it("bounds bytes, rejects an oversized active scope, and does not prefetch", () => {
    const cache = new SceneCache(new SceneMemory({ maxAdmissionBytes: 1000 }));
    const a = cache.put("a", scene());
    const bounded = new SceneCache(new SceneMemory({ maxAdmissionBytes: a.bytes + 1 }));
    bounded.put("a", scene());
    bounded.put("b", scene());
    expect([...bounded.entries.keys()]).toEqual(["b"]);
    expect(bounded.bytes).toBeLessThanOrEqual(bounded.maxBytes);
    expect(() =>
      new SceneCache(new SceneMemory({ maxAdmissionBytes: 1 })).put("large", scene()),
    ).toThrow("budget");
  });
  it("retains exact focuses ahead of optional context within the same byte limit", () => {
    const focus = scene();
    const context = scene();
    context.metadata.elements = [{ focus: false }] as SceneData["metadata"]["elements"];
    const cache = new SceneCache(
      new SceneMemory({ maxAdmissionBytes: 10000, maxDecodedScenes: 3 }),
    );
    const a = cache.put("focus-a", focus);
    cache.put("context-a", context);
    cache.put("focus-b", focus);
    cache.get("context-a");
    cache.put("context-b", context);
    expect(cache.get("focus-a")).toBe(a);
    expect(cache.get("context-a")).toBeUndefined();
    expect(cache.bytes).toBeLessThanOrEqual(cache.maxBytes);
  });
  it("invalidates scopes on document epoch or partition rebuild, preserving other documents", () => {
    const cache = new SceneCache(new SceneMemory());
    cache.put("a", scene());
    cache.put("other", scene(1, "b"));
    cache.put("new-epoch", scene(2));
    expect([...cache.entries.keys()]).toEqual(["other", "new-epoch"]);
    cache.put("recaptured", scene(2, "a", "later"));
    expect([...cache.entries.keys()]).toEqual(["other", "new-epoch", "recaptured"]);
    cache.put("rebuilt", scene(2, "a", "later", 3));
    expect([...cache.entries.keys()]).toEqual(["other", "rebuilt"]);
  });
  it("keeps active decoded storage accounted across revision invalidation and last release", () => {
    const memory = new SceneMemory();
    const cache = new SceneCache(memory);
    const a = cache.put("old", scene());
    const first = a.acquire(),
      second = a.acquire();
    cache.put("new", scene(2));
    expect(cache.get("old")).toBeUndefined();
    expect(memory.snapshot().owned.jsBufferBytes).toBe(72);
    first.release();
    first.release();
    expect(memory.snapshot().owned.jsBufferBytes).toBe(72);
    second.release();
    expect(memory.snapshot().owned.jsBufferBytes).toBe(36);
    cache.clear();
    expect(memory.snapshot().ownedAndReservedBytes).toBe(0);
  });
  it("uses one admission/count policy across specialized decoded stores", () => {
    const memory = new SceneMemory({ maxDecodedScenes: 1 });
    const a = new SceneCache(memory),
      b = new SceneCache(memory);
    a.put("a", scene());
    b.put("b", scene(1, "b"));
    expect(a.get("a")).toBeUndefined();
    expect(b.get("b")).toBeDefined();
    expect(memory.snapshot().retention.decodedScenes).toBe(1);
    b.clear();
  });
  it("preserves exact proxy admission and an old focus when a larger revision is refused", () => {
    const data = scene();
    data.positions = new Float32Array(new ArrayBuffer(1024), 64, 9);
    const proxy = 1024 + 36 * 4 + JSON.stringify(data.metadata).length * 2;
    expect(sceneAdmissionBytes(data)).toBe(proxy);
    const memory = new SceneMemory({ maxAdmissionBytes: proxy });
    const cache = new SceneCache(memory),
      old = cache.put("focus", data);
    const large = scene(2);
    large.positions = new Float32Array(new ArrayBuffer(2048));
    expect(() => cache.put("large", large)).toThrow("budget");
    expect(cache.get("focus")).toBe(old);
    expect(memory.snapshot().owned.jsBufferBytes).toBe(1024);
    cache.clear();
  });
});
