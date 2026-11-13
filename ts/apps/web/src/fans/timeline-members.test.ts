import { afterEach, expect, test, vi } from "vite-plus/test";
import type { WorkKey } from "@pe/agent-contracts";
import { hostTimeline } from "../../../host/src/reads/work-timeline";
import type { TimelineClient } from "../shell/work-feed-client";
import { createWitness } from "./cutover.test-support";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { snapshot } from "../ducts/test-fixture";
import { module as chat } from "../chat/route";
import { mountTypedRoute } from "../shell/typed-mount";
import { workFingerprintSchema } from "@pe/agent-contracts";

const closes: (() => void)[] = [];
afterEach(() => closes.splice(0).reverse().forEach(close => close()));

test("D25: /fans Timeline names Fans, Ducts, Ducts for undo, undo, redo", async () => {
  let host: ReturnType<typeof hostTimeline> | undefined;
  const listeners = new Set<() => Promise<void>>();
  const timeline: TimelineClient = {
    open(works, deliver) {
      let closed = false;
      const refresh = async () => {
        if (!host) return;
        const value = await host.read(works, "human");
        if (!closed) deliver(value);
      };
      listeners.add(refresh);
      void refresh();
      return () => { closed = true; listeners.delete(refresh); };
    },
    async step(request) {
      if (!host) throw Error("Host fixture not connected");
      const result = await host.step(request, { kind: "human", via: "local" }, "human");
      await Promise.all([...listeners].map(refresh => refresh()));
      return result && typeof result === "object" && "ok" in result && result.ok
        ? null : { message: JSON.stringify(result) };
    },
  };
  const f = await createWitness(closes, undefined, undefined, undefined, undefined, undefined, undefined, undefined, timeline);
  host = hostTimeline(f.ws, async () => []);
  await vi.waitFor(() => expect(f.owner.workBasis()).toBeTruthy());
  await vi.waitFor(() => expect(f.fans.workBasis()).toBeTruthy());
  const ducts = f.owner.work()!.handle.key;
  const fans = f.fans.work()!.handle.key;
  const fan = elementSubject(snapshot.nodes.find(node => node.id === 4)!);
  const edit = async (key: WorkKey, path: string[], value: unknown, label: string) => {
    const view = await f.ws.view(key, key.route);
    expect(await f.ws.write(key, key.route, "human", {
      kind: "apply", expectedRevision: view!.revision, press: crypto.randomUUID(),
      patches: [{ path, value: { edit: { value } } }], label,
    }, async () => [])).toMatchObject({ ok: true });
    await Promise.all([...listeners].map(refresh => refresh()));
    // Work chronology is timestamp ordered, as in the existing host door fixture.
    await new Promise(resolve => setTimeout(resolve, 3));
  };
  await edit(ducts, ["criteria", "velocitySupplyFpm"], 925, "Ducts supply velocity 925");
  await edit(fans, ["equipmentFlows", fan], { cfm: 1234 }, "Fans airflow 1234");
  const before = (await f.ws.view(ducts, "ducts"))!.doc;
  // Control: the real host has the Ducts edit when given both Work keys.
  expect((await host.read([ducts], "human")).undo).toMatchObject({ work: ducts });
  for (const [direction, work] of [["undo", fans], ["undo", ducts], ["redo", ducts]] as const) {
    expect(f.typed.timeline()?.[direction]).toMatchObject({ work });
    expect(await f.typed.stepTimeline(direction)).toBeNull();
    if (work === ducts) {
      const doc = (await f.ws.view(ducts, "ducts"))!.doc;
      if (direction === "undo") expect(doc).not.toEqual(before);
      else expect(doc).toEqual(before);
    }
  }
});

test("D25 diagnosis: document-bound Pea has no owner, never opens Timeline, and keeps unavailable", () => {
  const open = vi.fn(() => () => {});
  const mount = mountTypedRoute(chat, {
    address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    fixture: null, target: { kind: "document", ref: { session: "proof", openId: "document" } },
    work: { address: null, open: { session: "proof", openId: "document" } },
    custody: { current: () => true }, memory: () => ({}),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`), {
    timeline: { open, step: async () => null },
    sources: { [chat.spec.core!.key]: { kind: "use", open: () => () => {} } },
  });
  try {
    expect(mount.target()?.kind).toBe("document");
    expect(mount.spec.edits).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(mount.timeline()).toBeNull();
    expect(mount.timelineRefusal()).toBe("Timeline unavailable");
  } finally { mount.dispose(); }
});
