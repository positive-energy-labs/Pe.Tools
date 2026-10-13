import { expect, test } from "vite-plus/test";
import { devManifest } from "./dev-manifest";

test("dev install identity is stable per checkout and distinct from production", () => {
  const production = { id: "/", name: "Pe.Tools", scope: "/", display: "standalone" };
  const first = devManifest("C:\\repos\\Pe.Tools", production);
  const restarted = devManifest("c:/repos/pe.tools", production);
  const another = devManifest("C:/repos/Pe.Tools-worktree", production);
  expect(first.id).toBe(restarted.id);
  expect(first.id).not.toBe(production.id);
  expect(first.id).not.toBe(another.id);
  expect(first.name).toBe("Pe.Tools Dev");
  expect(first.scope).toBe("/");
  expect(production).toEqual({ id: "/", name: "Pe.Tools", scope: "/", display: "standalone" });
});
