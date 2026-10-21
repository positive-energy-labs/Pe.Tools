import { describe, expect, it } from "vite-plus/test";
import { SceneCache, type SceneData } from "./scene-cache";

const scene = (epoch = 1, document = "a", builtUtc = "now"): SceneData => ({
  positions: new Float32Array(9),
  metadata: {
    stamp: { epoch, hostDocumentKey: document, builtUtc },
    elements: [],
  } as unknown as SceneData["metadata"],
});

describe("resident Space scopes", () => {
  it("reuses exact arrays and evicts least recently visited scopes", () => {
    const cache = new SceneCache(10000, 2);
    const a = cache.put("a", scene());
    expect(Object.keys(a)).toEqual(["id", "bytes"]);
    cache.put("b", scene());
    expect(cache.get("a")).toBe(a);
    cache.put("c", scene());
    expect([...cache.entries.keys()]).toEqual(["a", "c"]);
  });
  it("bounds bytes, rejects an oversized active scope, and does not prefetch", () => {
    const cache = new SceneCache(1000);
    const a = cache.put("a", scene());
    const bounded = new SceneCache(a.bytes + 1);
    bounded.put("a", scene());
    bounded.put("b", scene());
    expect([...bounded.entries.keys()]).toEqual(["b"]);
    expect(bounded.bytes).toBeLessThanOrEqual(bounded.maxBytes);
    expect(() => new SceneCache(1).put("large", scene())).toThrow("budget");
  });
  it("invalidates scopes on document epoch or partition rebuild, preserving other documents", () => {
    const cache = new SceneCache();
    cache.put("a", scene());
    cache.put("other", scene(1, "b"));
    cache.put("new-epoch", scene(2));
    expect([...cache.entries.keys()]).toEqual(["other", "new-epoch"]);
    cache.put("rebuilt", scene(2, "a", "later"));
    expect([...cache.entries.keys()]).toEqual(["other", "rebuilt"]);
  });
});
