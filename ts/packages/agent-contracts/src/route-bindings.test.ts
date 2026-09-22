import { describe, expect, it } from "vite-plus/test";

import { familiesRouteState, familyProjectionSchema } from "./index.ts";

describe("route bindings", () => {
  it("bindings live on the Family projection, never on a route's authored Work", () => {
    const bind = { id: "profile-a", label: "Profile A" } as const;
    const projection = familyProjectionSchema.parse({ bindings: { profile: bind } });
    expect(projection.bindings.profile).toEqual(bind);
    expect(familyProjectionSchema.parse({}).bindings).toEqual({});
  });

  it("Families Work rejects a binding: a target is navigation, not authored input", () => {
    expect(() =>
      familiesRouteState.schema.parse({ bindings: { profile: { id: "a", label: "A" } } }),
    ).toThrow();
  });
});
