import { expect, test } from "vite-plus/test";
import { INVALID } from "./page-keys.ts";
import { z } from "zod";
import { field, manyField, manyCodec, decodePageField, sortField, keyedSetField, orderedListField } from "./route-field.ts";
import { routeAddress } from "./route-address.ts";

const typeProof = () => {
  // @ts-expect-error array Page fields have one kernel owner
  field(z.array(z.string()), {}, manyCodec);
  // @ts-expect-error wrappers cannot hide an array
  field(z.array(z.string()).default([]), {}, manyCodec);
  // @ts-expect-error callers cannot replace the many schema
  manyField("name", {}, z.array(z.string()));
  // @ts-expect-error options cannot override the schema either
  manyField("name", { schema: z.array(z.string()) });
};
void typeProof;

test("many round trips all and exact ids; cap refusal never truncates", () => {
  const f = manyField("name", { cap: 2 });
  for (const value of ["all", [], ["all", "a,b%~"]] as const) {
    const ids = typeof value === "string" ? value : [...value];
    expect(decodePageField(f, { pick: f.codec.encode(ids) }, "pick").decoded).toMatchObject({ success: true, data: ids });
  }
  expect(f.schema.safeParse(["a", "b", "c"]).success).toBe(false);
  expect(f.schema.safeParse([1]).success).toBe(false);
});
test("formerly narrowed routes preserve all through URL and Pea", () => {
  for (const [route, key] of [["pea", "selected"], ["home", "folded"], ["captures", "open"], ["rooms", "selected"], ["rooms", "layers"], ["space", "hidden"], ["space", "isolated"], ["space", "layers"], ["ducts", "layers"]] as const) {
    const address = routeAddress(route);
    expect(address.read({ [key]: "all" }).page).toHaveProperty(key, "all");
  }
});

test("sort and keyed set constructors own lossless codecs and reject malformed values", () => {
  const sort = sortField({ url: "replace" });
  const hidden = keyedSetField({ agent: "set" });
  for (const [f, value] of [[sort, { columns: [{ key: "a,b", dir: "desc" }, { key: "-x", dir: "asc" }] }], [hidden, { "a,b": true, "-x": true }]] as const) {
    expect(decodePageField(f, { x: f.codec.encode(value as never) }, "x").decoded).toMatchObject({ success: true, data: value });
    expect(f.codec.decode("invalid")).toBe(INVALID);
  }
  expect(sort.schema.safeParse({ columns: [{ key: "a", dir: "up" }] }).success).toBe(false);
  expect(sort.schema.safeParse({ columns: Array.from({ length: 9 }, () => ({ key: "a", dir: "asc" })) }).success).toBe(false);
  expect(hidden.schema.safeParse({ a: false }).success).toBe(false);
  expect(routeAddress("space").agent.keys).not.toContain("ids");
});

test("open-picture ordered lists preserve order, repeats and explicit empty through URLs", () => {
  const list = orderedListField(z.string().min(1), { cap: 3, url: "replace", agent: "set" });
  for (const items of [[], ["second,picture", "first%picture", "second,picture"]]) {
    const value = { items };
    const url = new URL("/captures", "http://test.invalid");
    url.searchParams.set("open", list.codec.encode(value));
    expect(decodePageField(list, Object.fromEntries(url.searchParams), "open")).toMatchObject({
      present: true,
      decoded: { success: true, data: value },
    });
  }
  for (const value of [
    [],
    "all",
    { items: "all" },
    { items: ["a", "b", "c", "d"] },
    { items: [1] },
    { items: [], extra: true },
  ])
    expect(list.schema.safeParse(value).success).toBe(false);
  expect(list.codec.decode("invalid")).toBe(INVALID);
  expect(list.codec.decode('{"items":[1]}')).toBe(INVALID);
  expect(() => orderedListField(z.string(), { cap: -1 })).toThrow();
});
