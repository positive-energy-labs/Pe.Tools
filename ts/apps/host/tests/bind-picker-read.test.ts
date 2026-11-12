import { expect, test } from "vite-plus/test";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import { bootHost } from "./real-server.ts";

/*
 * Gate c80e644a, /bind live: "Host does not own 'inventory'". The stream door (`observe`) routed
 * `inventory` to the session-inventory owner, and the read graph's resource door did not, so
 * `bind.picker` fell through to the adapter's default branch. One whole host, one real read.
 */
test("bind.picker reads threads, the session inventory and Pages through the read door", async () => {
  const host = await bootHost();
  try {
    const response = await fetch(`${host.base}/pe/reads/value`, {
      method: "POST",
      headers: { "content-type": "application/json", [HOST_CONTEXT_HEADER]: host.terminal },
      body: JSON.stringify({
        read: "bind.picker",
        args: { target: { kind: "host" } },
        subscription: "bind-picker",
        generation: 0,
      }),
    });
    const text = await response.text();
    expect(text).not.toContain("Host does not own");
    expect(response.status, text).toBe(200);
    const wire = JSON.parse(text);
    expect(wire.state, text).toBe("current");
    const { data } = wire.value;
    expect(Array.isArray(data.inventory.sessions), text).toBe(true);
    expect(Array.isArray(data.threads), text).toBe(true);
    // `bootHost` serves one Page, `carriage`.
    expect(data.pages, text).toContainEqual(expect.objectContaining({ slug: "carriage" }));
  } finally {
    await host.close();
  }
}, 60_000);
