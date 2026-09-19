/**
 * Two facts this fold owes: refusals order (no-target before not-ready before stale-revision —
 * the case moved here from `targeting/model.test.ts:192`), and a StrictMode double-mount disposes
 * the owner exactly once.
 */
import { expect, test, vi } from "vite-plus/test";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { firstRefusal, refuse, writeRefusal, REFUSAL_ORDER } from "./refusal";
import { createRouteOwner, parseTarget } from "./use-route";

// The host's answer to the stop is the only thing these tests vary.
const host = vi.hoisted(() => ({ settled: [] as PromiseSettledResult<unknown>[] }));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", async (actual) => ({
  ...(await actual<object>()),
  cancelRunningAdmissions: async () => host.settled,
}));

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

test("stop detaches the wait but keeps the action busy until it lands", async () => {
  host.settled = [{ status: "fulfilled", value: {} }];
  const registry = AtomRegistry.make();
  const owner = createRouteOwner("test", registry);
  let release = () => {};
  const first = owner.runAction("slow", async () => {
    await new Promise<void>((resolve) => (release = resolve));
    return null;
  });
  owner.stop();
  expect(await first).toBeNull();
  expect(registry.get(owner.log)[0]?.says).toMatch(/^stopped · /);
  expect((await owner.runAction("early", async () => null))?.code).toBe("busy");
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(await owner.runAction("after", async () => null)).toBeNull();
  owner.dispose();
});

test("a refused stop keeps waiting and says why in a sentence, never 'stopped'", async () => {
  host.settled = [
    { status: "rejected", reason: Error("The stop did not reach the host (404 Not Found).") },
  ];
  const registry = AtomRegistry.make();
  const owner = createRouteOwner("test", registry);
  let release = () => {};
  let landed = false;
  const running = owner
    .runAction("slow", async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return null;
    })
    .then(() => (landed = true));
  owner.stop();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const said = registry.get(owner.log).map((entry) => entry.says);
  expect(said).toContain("stop refused · The stop did not reach the host (404 Not Found).");
  expect(said.some((says) => says.startsWith("stopped"))).toBe(false);
  expect(landed).toBe(false);
  release();
  await running;
  owner.dispose();
});

test("a pending action retains the previous refusal until its result replaces it", async () => {
  const registry = AtomRegistry.make();
  const owner = createRouteOwner("test", registry);
  const previous = refuse("stale-revision", "reload first");
  registry.set(owner.failure, previous);
  let release = () => {};
  const running = owner.runAction("save", async () => {
    await new Promise<void>((resolve) => (release = resolve));
    return null;
  });
  expect(registry.get(owner.failure)).toEqual(previous);
  release();
  expect(await running).toBeNull();
  expect(registry.get(owner.failure)).toBeNull();
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

test("a picker target preserves its exact session and open document; malformed input cannot inherit a target", () => {
  const request = {
    kind: "open",
    ref: { session: "second-revit", openId: "same-file-other-open" },
  };
  expect(parseTarget(JSON.stringify(request))).toEqual({ kind: "request", request });
  expect(parseTarget("ux-revival")).toEqual({ kind: "session", session: "ux-revival" });
  expect(parseTarget("{broken")).toEqual({ kind: "session", session: "{broken" });
});

test("a verb refused as busy logs one line naming the verb still running, and keeps its refusal", async () => {
  const registry = AtomRegistry.make();
  const owner = createRouteOwner("test", registry);
  let release = () => {};
  const first = owner.runAction(
    "plan",
    async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return null;
    },
    undefined,
    undefined,
    "plan",
  );
  const refused = await owner.runAction(
    "apply",
    async () => null,
    undefined,
    undefined,
    "apply 2 rows",
  );
  expect(refused).toMatchObject({ code: "busy", message: "plan is still running" });
  expect(registry.get(owner.failure)).toEqual(refused);
  const [line] = registry.get(owner.log);
  expect(line).toMatchObject({
    kind: "verb",
    label: "apply 2 rows",
    says: "refused · plan is still running",
    refused: true,
  });
  release();
  await first;
  owner.dispose();
});
