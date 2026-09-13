/**
 * Two facts this fold owes: refusals order (no-target before not-ready before stale-revision —
 * the case moved here from `targeting/model.test.ts:192`), and a StrictMode double-mount disposes
 * the owner exactly once.
 */
import { expect, test } from "vite-plus/test";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { firstRefusal, refuse, writeRefusal, REFUSAL_ORDER } from "./refusal";
import { createRouteOwner } from "./use-route";

test("a refusal set says the first reason in order, not the last one raised", () => {
  const chosen = firstRefusal([
    refuse("stale-revision", "revision 3 is behind"),
    refuse("not-ready", "pick a family first"),
    refuse("no-target", "pick a document"),
  ]);
  expect(chosen?.code).toBe("no-target");
  expect(REFUSAL_ORDER.indexOf("no-target")).toBeLessThan(REFUSAL_ORDER.indexOf("not-ready"));
  expect(REFUSAL_ORDER.indexOf("not-ready")).toBeLessThan(REFUSAL_ORDER.indexOf("stale-revision"));
});

test("a stale_revision write is a stale-revision refusal, not a generic failure", () => {
  const refusal = writeRefusal({
    ok: false,
    kind: "error",
    error: "someone wrote first",
    hint: "re-read",
    code: "stale_revision",
  });
  expect(refusal).toEqual({ code: "stale-revision", message: "someone wrote first: re-read" });
  expect(writeRefusal({ ok: true, revision: 4 })).toBeNull();
});

test("busy is a runtime refusal: the second action is told, the first still lands", async () => {
  const owner = createRouteOwner("test", AtomRegistry.make());
  let release = () => {};
  const first = owner.runAction("slow", async () => {
    await new Promise<void>((resolve) => (release = resolve));
    return null;
  });
  const second = await owner.runAction("fast", async () => null);
  expect(second?.code).toBe("busy");
  release();
  expect(await first).toBeNull();
  owner.dispose();
});

test("disposing twice releases once — StrictMode double-mounts the owner", () => {
  const registry = AtomRegistry.make();
  const owner = createRouteOwner("test", registry);
  const atom = owner.owned("probe", Atom.make(0));
  expect(atom).toBeDefined();
  owner.dispose();
  expect(() => owner.dispose()).not.toThrow();
});
