import { describe, expect, it } from "vite-plus/test";
import { SceneCache, type SceneData } from "./scene-cache";

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
  it("retains exact focuses ahead of optional context within the same byte limit", () => {
    const focus = scene();
    const context = scene();
    context.metadata.elements = [{ focus: false }] as SceneData["metadata"]["elements"];
    const cache = new SceneCache(10000, 3);
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
    const cache = new SceneCache();
    cache.put("a", scene());
    cache.put("other", scene(1, "b"));
    cache.put("new-epoch", scene(2));
    expect([...cache.entries.keys()]).toEqual(["other", "new-epoch"]);
    cache.put("recaptured", scene(2, "a", "later"));
    expect([...cache.entries.keys()]).toEqual(["other", "new-epoch", "recaptured"]);
    cache.put("rebuilt", scene(2, "a", "later", 3));
    expect([...cache.entries.keys()]).toEqual(["other", "rebuilt"]);
  });
});
