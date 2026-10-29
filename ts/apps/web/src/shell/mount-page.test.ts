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
