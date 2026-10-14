import { expect, test } from "vite-plus/test";
import { HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { hostOwnership } from "../src/host-ownership.ts";
import { admitRequest } from "../src/control.ts";
import { bootHost } from "./real-server.ts";

/**
 * ADR 0017 D1: anonymous callers are read-only. The add-in calls back into the host with no context
 * (`TsHostCallClient`: pod.list and pod.capture only), and every native script died on
 * `context.missing` when /call refused every anonymous caller. Those two reads, and nothing else.
 */
test("an anonymous local call reads Pods and nothing else", async () => {
  const host = await bootHost();
  try {
    const post = (key: string, request: unknown = {}) =>
      fetch(`${host.base}/call`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
        },
        body: JSON.stringify({ key, request }),
      });
    const read = await post("pod.list");
    expect([read.status, await read.text()]).toEqual([200, expect.stringContaining("pods")]);
    // Every other key refuses before classification: a side effect, a cancel, a host read.
    for (const [key, request] of [
      ["host.shell.open", { path: "C:/" }],
      ["op.cancel", { requestId: "00000000-0000-4000-8000-000000000000" }],
      ["logs.tail", {}],
    ] as const) {
      const refused = await post(key, request);
      expect([key, refused.status]).toEqual([key, 403]);
      expect(await refused.text()).toContain("context.missing");
    }
  } finally {
    await host.close();
  }
}, 30_000);

test("the service caller stays limited to shutdown and window at /call", () => {
  expect(() =>
    admitRequest(
      { kind: "service", service: hostOwnership.serviceName },
      "operation",
      "POST /call",
    ),
  ).toThrow(/shutdown and window/);
});
