import { expect, test } from "vite-plus/test";
import { createAdmittedRetention } from "./admitted-retention.ts";
test("preparation rejects overflow without losing the resident attempt", () => {
 const store = createAdmittedRetention<string>({entries: 1, bytes: 10});
 expect(store.set("one", "a").kind).toBe("stored");
 expect(store.set("two", "b").kind).toBe("overload");
 expect(store.get("one")).toBe("a");
 expect(store.get("two")).toBeUndefined();
 expect(store.set("one", "a long value").kind).toBe("overload");
 expect(store.get("one")).toBe("a");
 store.delete("one");
 expect(store.set("two", "b").kind).toBe("stored");
 store.clear();
 expect(store.entries()).toEqual([]);
});
test("retention budgets UTF-8 bytes, including replacement", () => {
 const store = createAdmittedRetention<string>({entries: 2, bytes: 6});
 expect(store.set("one", "\u00e9").kind).toBe("stored");
 expect(store.set("two", "\u00e9").kind).toBe("overload");
 expect(store.set("one", "").kind).toBe("stored");
 expect(store.set("two", "\u00e9").kind).toBe("stored");
});
