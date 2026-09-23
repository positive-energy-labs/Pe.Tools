import { describe, expect, it, vi } from "vite-plus/test";
import type { FamiliesView } from "@pe/agent-contracts";
import { RouteViewStore } from "./route-view-store.ts";

const view = (instance: string, thread = "t"): FamiliesView => ({
  thread,
  instance,
  surface: "chat",
  stage: "archived",
  rules: "",
  ruleHelp: [],
  readingId: "read-1",
  document: { session: "s", openId: "o" },
  work: { route: "families", binding: "host", target: null },
  counts: { families: 2, types: 3, parameters: 4 },
});
const id1 = "00000000-0000-4000-8000-000000000001";
const id2 = "00000000-0000-4000-8000-000000000002";

describe("mounted Families view custody", () => {
  it("refuses ambiguity and only acknowledges rendered rules on the exact context", async () => {
    const store = new RouteViewStore();
    const first = store.publish(view(id1));
    store.publish(view(id2));
    expect(store.select("t")).toMatchObject({ ok: false, instances: [id1, id2] });
    let intent: { commandId: string } | undefined;
    store.subscribe((value) => {
      intent = value;
    });
    const result = store.setRules("t", id1, first.revision, "blank");
    expect(
      store.ack({
        instance: id1,
        commandId: intent!.commandId,
        revision: first.revision,
        rules: "wrong",
        counts: first.counts,
      }).ok,
    ).toBe(false);
    store.publish({ ...view(id1), rules: "blank" });
    expect(
      store.ack({
        instance: id1,
        commandId: intent!.commandId,
        revision: first.revision,
        rules: "blank",
        counts: first.counts,
      }).ok,
    ).toBe(true);
    await expect(result).resolves.toMatchObject({ ok: true, rules: "blank" });
    const next = store.select("t", id1)!;
    expect("revision" in next && next.revision).toBeGreaterThan(first.revision);
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
      const result = store.setRules("t", id1, first.revision, "filled");
      store.publish({ ...view(id1), readingId: "read-2", rules: "filled" });
      expect(
        store.ack({
          instance: id1,
          commandId,
          revision: first.revision,
          rules: "filled",
          counts: first.counts,
        }).ok,
      ).toBe(false);
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(result).resolves.toMatchObject({ ok: false });
      await vi.advanceTimersByTimeAsync(7_000);
      expect(store.select("t", id1)).toBeNull();
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
      const result = store.setRules("old-thread", id1, first.revision, "blank");
      store.publish({ ...view(id1, "new-thread"), rules: "blank" });
      expect(store.select("old-thread", id1)).toBeNull();
      expect(
        store.ack({
          instance: id1,
          commandId,
          revision: first.revision,
          rules: "blank",
          counts: first.counts,
        }).ok,
      ).toBe(false);
      store.remove(id1);
      await expect(result).resolves.toMatchObject({ ok: false, error: "view unmounted" });
      expect(store.select("new-thread", id1)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
