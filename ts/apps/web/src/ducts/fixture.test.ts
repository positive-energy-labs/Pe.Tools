import { expect, test, vi } from "vite-plus/test";
import { createFixtureMount } from "#/shell/fixture";
import { ductsGraph } from "./graph";
test.each(["scene", "colours", "navigation"])(
  "ducts fixture %s reads without a worker or host",
  (name) => {
    const fetch = vi.fn(() => {
      throw Error("Host called");
    });
    vi.stubGlobal("fetch", fetch);
    const owner = createFixtureMount(ductsGraph, name);
    const release = owner.connect();
    const demand = owner.readings.mount(["pricing"]);
    try {
      expect(owner.readings.get("ducts").status).toBe("ready");
      expect(owner.readings.get("pricing").status).toBe("ready");
      expect(owner.snapshot().work).not.toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      demand();
      release();
      owner.dispose();
      vi.unstubAllGlobals();
    }
  },
);
