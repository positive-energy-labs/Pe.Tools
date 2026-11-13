import { expect, test, vi } from "vite-plus/test";
import { bindWork, memberWork, podMemberCode, settingsRouteState, workFingerprintSchema, type WorkKey } from "@pe/agent-contracts";
import { module as pods } from "../pods/route";
import { mountTypedRoute } from "../shell/typed-mount";
import { createFixtureWorkDoor } from "../shell/fixture-work-door";
import type { UseSource } from "../shell/source-contract";
import { z } from "zod";

// Review 8d8f690a's probe: retain A's drawing while B's read is deliberately held.
test("D25: switching Pod member retains drawing but grants no stale Timeline authority", async () => {
  const a = { pod: "proof", path: "a.json" }, b = { pod: "proof", path: "b.json" };
  const ak = bindWork("pods", null, memberWork(a));
  const bk = bindWork("pods", null, memberWork(b));
  const basis = { member: a, rawContent: "{}", sha256: "f".repeat(64) };
  let answerB: () => void = () => { throw Error("B's read has not started"); };
  const source: UseSource = { kind: "use", open(ctx, deliver) {
    const member = z.object({ path: z.string() }).parse(ctx.args).path === a.path ? a : b;
    const send = () => deliver({ kind: "complete", revision: 1, value: { key: "proof", generation: 0, version: 1, state: "current", value: {
      data: { scope: { ...member, runs: "member" }, member: { member, content: "{}", sha256: basis.sha256 }, work: { basis: { ...basis, member }, fields: {} }, draft: "{}", composition: null, schemaRef: null, runs: [], unresolved: [], assumed: [], next: null, inputs: [], result: { kind: "complete", value: "ready" } },
      evaluation: "proof", inputs: "proof", works: [bindWork("pods", null, memberWork(member))], trace: [], origin: {}, coverage: { requested: [], covered: [], unknown: [], refused: [] }, freshness: "current",
    } } });
    if (member === a) send(); else answerB = send;
    return () => {};
  } };
  let members: readonly WorkKey[] = [];
  const step = vi.fn(async () => null);
  const mount = mountTypedRoute(pods, {
    address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} }, fixture: null,
    target: { kind: "host" }, work: { address: null, open: null }, custody: { current: () => true },
    memory: () => ({ member: { kind: "ids", ids: [podMemberCode(a)] } }),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), {
    work: createFixtureWorkDoor(settingsRouteState, { basis, fields: {} }),
    sources: { "pods.author": source, "pods.roster": { kind: "use", open: () => () => {} } },
    timeline: { open(works, deliver) {
      members = works;
      deliver({ rows: [], undo: works.some(w => w.binding === "workspace" && w.work === memberWork(a)) ? { work: ak, revision: 1, label: "Edit a.json" } : null, redo: null, refusal: { undo: null, redo: null } });
      return () => { members = []; };
    }, step },
  });
  try {
    expect(mount.value().state).toBe("ready");
    mount.page.subject({ kind: "ids", ids: [podMemberCode(b)] });
    expect(mount.value()).toMatchObject({ state: "refreshing", value: { scope: a } });
    expect(members).not.toContainEqual(ak);
    expect(mount.timeline()?.undo ?? null).toBeNull();
    expect(mount.timeline()?.redo ?? null).toBeNull();
    expect(mount.timelineRefusal()).toMatch(/reading/i);
    expect(await mount.stepTimeline("undo")).toEqual({ message: expect.stringMatching(/reading/i) });
    expect(await mount.stepTimeline("redo")).toEqual({ message: expect.stringMatching(/reading/i) });
    expect(step).not.toHaveBeenCalled();
    answerB();
    expect(mount.value()).toMatchObject({ state: "ready", value: { scope: b } });
    expect(members).toEqual([bk]);
    expect(mount.timelineRefusal()).toBeNull();
  } finally { mount.dispose(); }
});
