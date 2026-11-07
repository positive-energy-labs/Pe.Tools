import { expect, test } from "vite-plus/test";
import { graphRoute } from "../src/reads/routes.ts";

test.each(["families.view", "schedules.view"])("%s binds both document wire forms to the same read", (read) => {
  const ref = { session: "S1", openId: "A" };
  const bind = (target: unknown) => graphRoute("reads.value", {
    subscription: "browser", generation: 1, read,
    args: { target, ...(read === "schedules.view" ? { workspaceId: null } : {}) },
  });
  const bare = bind(ref);
  const wrapped = bind({ kind: "document", ref });
  expect(wrapped.args).toEqual(bare.args);
  expect(wrapped.key).toBe(bare.key);
  expect(() => bind({ kind: "host" })).toThrow();
  expect(() => bind({ kind: "document", ref: { session: "S1" } })).toThrow();
});
