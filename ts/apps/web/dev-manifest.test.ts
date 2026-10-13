import { expect, test } from "vite-plus/test";
import { devManifest } from "./dev-manifest";

test("dev lane retains its installed identity across restarts and is distinct from production", () => {
  const production = { id: "/", name: "Pe.Tools", scope: "/", display: "standalone" };
  const first = devManifest(production);
  const restarted = devManifest({ ...production });
  const another = devManifest({ ...production, name: "Another checkout" });
  expect(first.id).toBe(restarted.id);
  expect(first.id).not.toBe(production.id);
  expect(first.id).toBe(another.id);
  expect(first.id).toBe("/?dev=e342bc78d3d4");
  expect(first.name).toBe("Pe.Tools Dev");
  expect(first.scope).toBe("/");
  expect(production).toEqual({ id: "/", name: "Pe.Tools", scope: "/", display: "standalone" });
});
