import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";
import { graphUrlPage } from "./mount-page";

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
