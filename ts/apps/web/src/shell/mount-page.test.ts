import { describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { graphUrlPage, readLayoutState, writeLayoutState } from "./mount-page";

describe("graphUrlPage.read", () => {
  test("a router-parsed number or boolean re-enters the field's string codec", () => {
    const codec = { encode: (v: unknown) => String(v), decode: (s: string) => s };
    const url = graphUrlPage({
      fields: {
        level: { schema: z.string().default("10"), codec, role: "query" },
        on: { schema: z.enum(["true", "false"]).default("false"), codec, role: "query" },
        pick: { schema: z.string().default("none"), codec, role: "query" },
      },
    } as never);
    expect(url.read({ level: 30, on: true, pick: ["a"] })).toEqual({
      level: "30",
      on: "true",
      pick: "none",
    });
  });
});

describe("graphUrlPage.write", () => {
  test("a field at its resting value is absent from the URL", () => {
    const codec = { encode: (v: unknown) => String(v), decode: (s: string) => s };
    const url = graphUrlPage(
      {
        fields: {
          level: { schema: z.string(), codec, role: "subject" },
          cfm: { schema: z.string().default("1000"), codec, role: "query" },
        },
      } as never,
      { level: "" } as never,
    );
    expect(url.write({ level: "", cfm: "1000" } as never)).toEqual({
      level: undefined,
      cfm: undefined,
    });
    expect(url.write({ level: "L2", cfm: "1000" } as never)).toEqual({
      level: "L2",
      cfm: undefined,
    });
  });
});

test("device layout validates persisted data and tolerates unavailable storage", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key),
    setItem: (key: string, value: string) => values.set(key, value),
  });
  try {
    writeLayoutState("rooms", { plan: { folded: true, sizes: { seam: 320 } } });
    expect(readLayoutState("rooms")).toEqual({ plan: { folded: true, sizes: { seam: 320 } } });
    values.set(
      "rooms",
      JSON.stringify({
        plan: { folded: "bad", sizes: { seam: -5, good: 200, bad: "x" } },
        broken: null,
      }),
    );
    expect(readLayoutState("rooms")).toEqual({ plan: { sizes: { good: 200 } } });
    values.set("rooms", "{bad");
    expect(readLayoutState("rooms")).toEqual({});
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("disabled");
      },
      setItem: () => {
        throw Error("disabled");
      },
    });
    expect(readLayoutState("rooms")).toEqual({});
    expect(() => writeLayoutState("rooms", {})).not.toThrow();
  } finally {
    vi.unstubAllGlobals();
  }
});
