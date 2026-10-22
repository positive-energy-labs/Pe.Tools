import { describe, expect, it, vi } from "vite-plus/test";
import type { RouteView } from "@pe/agent-contracts";
import { RouteViewStore } from "./route-view-store.ts";

const counts = { families: 2, types: 3, parameters: 4 };
const view = (instance: string, thread = "t"): RouteView => ({
  route: "families",
  thread,
  instance,
  surface: "chat",
  page: { query: "" },
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
  page: { system: "", level: "", selected: "" },
  context: { document: { session: "s", openId: "o" } },
  facts: { systems: [{ name: "Supply 1" }] },
});
const id1 = "00000000-0000-4000-8000-000000000001";
const id2 = "00000000-0000-4000-8000-000000000002";

describe("mounted route view custody", () => {
  it("refuses ambiguity and only acknowledges the rendered patch on the exact context", async () => {
    const store = new RouteViewStore();
    const first = store.publish(view(id1));
    store.publish(view(id2));
    expect(store.select("t", "families")).toMatchObject({ ok: false, instances: [id1, id2] });
    let intent: { commandId: string } | undefined;
    store.subscribe((value) => {
      intent = value;
    });
    const result = store.set("t", "families", id1, first.revision, { query: "blank" });
    const ack = (query: string) =>
      store.ack({
        outcome: "rendered",
        instance: id1,
        commandId: intent!.commandId,
        revision: first.revision,
        page: { query },
        facts: first.facts,
      }).ok;
    expect(ack("wrong")).toBe(false);
    store.publish({ ...view(id1), page: { query: "blank" } });
    expect(ack("blank")).toBe(true);
    await expect(result).resolves.toMatchObject({ ok: true, page: { query: "blank" } });
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
    const result = store.set("t", "ducts", id1, lease.revision, { system: "Supply 1" });
    store.publish({ ...ducts(id1), page: { system: "Supply 1", level: "", selected: "" } });
    expect(
      store.ack({
        outcome: "rendered",
        instance: id1,
        commandId,
        revision: lease.revision,
        page: { system: "Supply 1", level: "", selected: "" },
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
      const result = store.set("t", "families", id1, first.revision, { query: "filled" });
      store.publish({
        ...view(id1),
        context: { ...view(id1).context, readingId: "read-2" },
        page: { query: "filled" },
      });
      expect(
        store.ack({
          outcome: "rendered",
          instance: id1,
          commandId,
          revision: first.revision,
          page: { query: "filled" },
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
      const result = store.set("old-thread", "families", id1, first.revision, { query: "blank" });
      store.publish({ ...view(id1, "new-thread"), page: { query: "blank" } });
      expect(store.select("old-thread", "families", id1)).toBeNull();
      expect(
        store.ack({
          outcome: "rendered",
          instance: id1,
          commandId,
          revision: first.revision,
          page: { query: "blank" },
          facts: first.facts,
        }).ok,
      ).toBe(false);
      store.remove(id1);
      await expect(result).resolves.toMatchObject({ ok: false, error: "view unmounted" });
      expect(store.select("new-thread", "families", id1)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
