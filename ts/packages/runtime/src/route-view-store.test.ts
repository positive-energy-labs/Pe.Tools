import { describe, expect, it, vi } from "vite-plus/test";
import { routeAddress } from "@pe/agent-contracts";
import type { RouteView } from "@pe/agent-contracts";
import { RouteViewStore } from "./route-view-store.ts";

const wire = (value: string) => JSON.stringify(value);
const counts = { families: 2, types: 3, parameters: 4 };
const view = (instance: string, thread = "t"): RouteView => ({
  route: "families",
  thread,
  instance,
  surface: "chat",
  page: { readId: wire("") },
  context: {
    stage: "history",
    readingId: "read-1",
    document: { session: "s", openId: "o" },
    work: { route: "families", binding: "host", target: null },
  },
  facts: { counts, ruleHelp: [] },
});
const ducts = (instance: string): RouteView => ({
  route: "ducts",
  thread: "t",
  instance,
  surface: "route",
  page: routeAddress("ducts").agent.write(routeAddress("ducts").defaults),
  context: { document: { session: "s", openId: "o" } },
  facts: { systems: [{ name: "Supply 1" }] },
});
const id1 = "00000000-0000-4000-8000-000000000001";
const id2 = "00000000-0000-4000-8000-000000000002";

describe("mounted route view custody", () => {
  it("fences an admitted route by agent policy and forwards its codec text undecoded", async () => {
    const fields = {
      fan: { role: "subject", agent: "set" },
      viewport: { role: "pose", agent: "read" },
    } as never;
    const store = new RouteViewStore(() => [{ key: "ducts", title: "Ducts", address: "/ducts", fields }]);
    const lease = store.publish({ ...ducts(id1), page: { fan: "", viewport: "" } });
    expect(await store.set("t", "ducts", id1, lease.revision, { viewport: "{}" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("may not set"),
    });
    let patch: unknown;
    store.subscribe((value) => {
      if (value.type === "route-view-intent") patch = value.patch;
    });
    // Admitted JSON codec text that no legacy ducts codec reads; the owner decodes and settles it.
    const text = JSON.stringify({ kind: "ids", ids: [4] });
    void store.set("t", "ducts", id1, lease.revision, { fan: text });
    expect(patch).toEqual({ fan: text });
  });

  it("leases only a builtin agent address or a registered opt-in Pod, through the owner codec", async () => {
    const pod = { fan: { role: "subject", agent: "set" } } as never;
    const silent = { fan: { role: "subject", agent: "none" } } as never;
    const registered = [
      { key: "acme-fans", title: "Acme fans", address: "/tool/acme-fans", fields: pod },
      { key: "acme-quiet", title: "Acme quiet", address: "/tool/acme-quiet", fields: silent },
    ];
    const store = new RouteViewStore(() => registered);
    expect(store.leasesView("families")).toBe(true);
    expect(store.leasesView("acme-unregistered")).toBe(false);
    expect(store.leasesView("acme-quiet")).toBe(false);
    expect(store.leasesView("acme-fans")).toBe(true);
    expect(store.open("acme-quiet", { thread: "t" }).ok).toBe(false);
    const lease = store.publish({ ...ducts(id1), route: "acme-fans", page: { fan: "" } });
    let intent: { commandId: string; patch: unknown } | undefined;
    store.subscribe((value) => {
      if (value.type === "route-view-intent") intent = value;
    });
    const text = JSON.stringify({ kind: "ids", ids: [7] });
    const result = store.set("t", "acme-fans", id1, lease.revision, { fan: text });
    expect(intent?.patch).toEqual({ fan: text });
    store.publish({ ...ducts(id1), route: "acme-fans", page: { fan: text } });
    store.ack({ outcome: "rendered", instance: id1, commandId: intent!.commandId, revision: lease.revision, page: { fan: text }, facts: ducts(id1).facts });
    expect(await result).toMatchObject({ ok: true });
    registered.length = 0;
    await expect(store.set("t", "acme-fans", id1, lease.revision, { fan: text })).resolves.toMatchObject({ ok: false });
  });

  it("refuses ambiguity and only acknowledges the rendered patch on the exact context", async () => {
    const store = new RouteViewStore();
    const first = store.publish(view(id1));
    store.publish(view(id2));
    expect(store.select("t", "families")).toMatchObject({ ok: false, instances: [id1, id2] });
    let intent: { commandId: string } | undefined;
    store.subscribe((value) => {
      intent = value;
    });
    const result = store.set("t", "families", id1, first.revision, { readId: wire("blank") });
    const ack = (readId: string) =>
      store.ack({
        outcome: "rendered",
        instance: id1,
        commandId: intent!.commandId,
        revision: first.revision,
        page: { readId: wire(readId) },
        facts: first.facts,
      }).ok;
    expect(ack("wrong")).toBe(false);
    store.publish({ ...view(id1), page: { readId: wire("blank") } });
    expect(ack("blank")).toBe(true);
    await expect(result).resolves.toMatchObject({ ok: true, page: { readId: wire("blank") } });
    const next = store.select("t", "families", id1)!;
    expect("revision" in next && next.revision).toBeGreaterThan(first.revision);
  });

  it("keeps one lease per route and refuses keys the lease does not offer", async () => {
    const store = new RouteViewStore();
    const lease = store.publish(ducts(id1));
    expect(store.select("t", "families")).toMatchObject({ ok: false });
    await expect(
      store.set("t", "ducts", id1, lease.revision, { query: "x" }),
    ).resolves.toMatchObject({ ok: false });
    await expect(store.set("t", "ducts", id1, lease.revision, {})).resolves.toMatchObject({
      ok: false,
    });
    let commandId = "";
    store.subscribe((intent) => {
      commandId = intent.commandId;
    });
    const system = JSON.stringify({kind:"ids",ids:[JSON.stringify(["ducts-system","Supply 1"])]});
    const page = {...ducts(id1).page,system};
    const result = store.set("t", "ducts", id1, lease.revision, { system });
    store.publish({ ...ducts(id1), page });
    expect(
      store.ack({
        outcome: "rendered",
        instance: id1,
        commandId,
        revision: lease.revision,
        page,
        facts: lease.facts,
      }).ok,
    ).toBe(true);
    await expect(result).resolves.toMatchObject({ ok: true });
  });

  it("refuses a changed reading and retires an expired lease", async () => {
    vi.useFakeTimers();
    try {
      const store = new RouteViewStore();
      const first = store.publish(view(id1));
      let commandId = "";
      store.subscribe((intent) => {
        commandId = intent.commandId;
      });
      const result = store.set("t", "families", id1, first.revision, { readId: wire("filled") });
      store.publish({
        ...view(id1),
        context: { ...view(id1).context, readingId: "read-2" },
        page: { readId: wire("filled") },
      });
      expect(
        store.ack({
          outcome: "rendered",
          instance: id1,
          commandId,
          revision: first.revision,
          page: { readId: wire("filled") },
          facts: first.facts,
        }).ok,
      ).toBe(false);
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(result).resolves.toMatchObject({ ok: false });
      await vi.advanceTimersByTimeAsync(7_000);
      expect(store.select("t", "families", id1)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not carry a pane command across thread or visibility changes", async () => {
    vi.useFakeTimers();
    try {
      const store = new RouteViewStore();
      const first = store.publish(view(id1, "old-thread"));
      let commandId = "";
      store.subscribe((intent) => {
        commandId = intent.commandId;
      });
      const result = store.set("old-thread", "families", id1, first.revision, { readId: wire("blank") });
      store.publish({ ...view(id1, "new-thread"), page: { readId: wire("blank") } });
      expect(store.select("old-thread", "families", id1)).toBeNull();
      expect(
        store.ack({
          outcome: "rendered",
          instance: id1,
          commandId,
          revision: first.revision,
          page: { readId: wire("blank") },
          facts: first.facts,
        }).ok,
      ).toBe(false);
      store.remove(id1);
      await expect(result).resolves.toMatchObject({ ok: false, error: "view lease was released" });
      expect(store.select("new-thread", "families", id1)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
