import { expect, test, vi } from "vite-plus/test";
import * as tiers from "../src/tiered-settings.ts";
import { fixture } from "./host-read-graph.test-support.ts";

test("W3a live settings reads pass through the tier watch", async () => {
  const original = tiers.watchSettingTiers;
  const watched = vi.fn();
  const spy = vi.spyOn(tiers, "watchSettingTiers").mockImplementation((changed) => {
    const watcher = original(changed);
    return {
      ...watcher,
      read: (...args) => {
        watched(...args);
        return watcher.read(...args);
      },
    };
  });
  const f = await fixture();
  try {
    await f.send(1, []);
    expect(watched).toHaveBeenCalledWith("ducts", undefined);
  } finally {
    await f.close();
    spy.mockRestore();
  }
});
