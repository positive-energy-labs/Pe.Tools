import { expect, test, vi } from "vite-plus/test";
import { readLayoutState, writeLayoutState } from "./layout-state";

test("device layout validates persisted data and tolerates unavailable storage", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key),
    setItem: (key: string, value: string) => values.set(key, value),
  });
  try {
    writeLayoutState("zones", { plan: { folded: true, sizes: { seam: 320 } } });
    expect(readLayoutState("zones")).toEqual({ plan: { folded: true, sizes: { seam: 320 } } });
    values.set(
      "zones",
      JSON.stringify({
        plan: { folded: "bad", sizes: { seam: -5, good: 200, bad: "x" } },
        broken: null,
      }),
    );
    expect(readLayoutState("zones")).toEqual({ plan: { sizes: { good: 200 } } });
    values.set("zones", "{bad");
    expect(readLayoutState("zones")).toEqual({});
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("disabled");
      },
      setItem: () => {
        throw Error("disabled");
      },
    });
    expect(readLayoutState("zones")).toEqual({});
    expect(() => writeLayoutState("zones", {})).not.toThrow();
  } finally {
    vi.unstubAllGlobals();
  }
});
