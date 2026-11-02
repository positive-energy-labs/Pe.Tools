import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { field, manyField, manyCodec, decodePageField } from "./route-field.ts";
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
