import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";
import { defineRoute } from "./manifest";
import { urlPage } from "./url";

const manifest = defineRoute({
  key: "t",
  name: "T",
  page: z.intersection(
    z.object({ stage: z.enum(["a", "b"]).default("a"), epoch: z.number().default(0) }),
    z.object({ selected: z.string().default(""), layers: z.array(z.string()).default([]) }),
  ),
  url: ["stage", "selected", "layers"],
});
const url = urlPage(manifest)!;

describe("urlPage", () => {
  test("reads the address through the page schema: numbers back to strings, lists split, bad values to default", () => {
    expect(url.read({ selected: 8081605, layers: "a,b", stage: "zzz", epoch: 9 })).toEqual({
      stage: "a",
      selected: "8081605",
      layers: ["a", "b"],
    });
    expect(url.read({})).toEqual({ stage: "a", selected: "", layers: [] });
  });

  test("writes only the url keys, lists joined", () => {
    expect(url.write({ stage: "b", selected: "x", layers: ["a", "b"], epoch: 3 })).toEqual({
      stage: "b",
      selected: "x",
      layers: "a,b",
    });
  });

  test("the middleware keeps a bare URL bare", () => {
    const [strip] = url.middlewares;
    const search = { stage: "a", selected: "", layers: "", target: "x" };
    expect(strip!({ search, next: (s: unknown) => s } as never)).toEqual({ target: "x" });
  });

  test("a url key without a default is refused at definition", () => {
    expect(() =>
      urlPage(defineRoute({ key: "u", name: "U", page: z.object({ q: z.string() }), url: ["q"] })),
    ).toThrow(/needs a default/);
    expect(urlPage(defineRoute({ key: "v", name: "V" }))).toBeNull();
  });
});
